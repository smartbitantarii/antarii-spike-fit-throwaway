//! §4 — Numbers: exact decimals, scale, and the precision of a comparison.
//!
//! 🔴 WHAT THIS IMPLEMENTS, CLAUSE BY CLAUSE, because every choice below is
//! the specification's and not this file's:
//!
//! - **§4.1** all arithmetic is exact decimal; binary floating point is
//!   forbidden "as a representation at every stage". *So there is no `f64`
//!   anywhere in this module, not even in a test.*
//! - **§4.4** `+ − ×` apply no rounding: the result carries the scale the
//!   exact arithmetic produces.
//! - **§4.5** `÷` yields a result at `N-D1`'s scale, rounded **half away from
//!   zero**. ⚠ See `div`'s own note: `N-D1` is currency-dependent, so the
//!   scale is a parameter here rather than a constant.
//! - **§4.6** comparison is exact over the values as held.
//! - **§4.7** division by zero yields *no value*, not an error — modelled as
//!   `None`, and `Value::NoValue` carries it in the value domain.
//! - **§4.8** a number crosses every boundary as a **decimal string**, with
//!   the scale carried by the digits present.
//! - **§8.4** `round` to *n* places, half away from zero.

use core::cmp::Ordering;

/// An exact decimal: a sign, base-10 digits, and a scale.
///
/// ➕ **Arbitrary precision, deliberately.** §4.8 rejects a scaled integer
/// partly because "beyond 2⁵³ a `number` is lossy", and a fixed-width mantissa
/// would reintroduce exactly the limit the clause rules out. The digits are
/// held most-significant-first with no leading zeros, so the representation of
/// a given value at a given scale is unique.
#[derive(Clone, Debug)]
pub struct Decimal {
    neg: bool,
    /// Most significant first. Empty means zero.
    digits: Vec<u8>,
    /// Digits after the decimal point.
    scale: u32,
}

impl Decimal {
    pub fn zero(scale: u32) -> Self {
        Decimal { neg: false, digits: Vec::new(), scale }
    }

    pub fn scale(&self) -> u32 {
        self.scale
    }

    pub fn is_zero(&self) -> bool {
        self.digits.is_empty()
    }

    pub fn is_negative(&self) -> bool {
        self.neg && !self.is_zero()
    }

    /// §4.8 — parse the boundary form: optional sign, digits, optional point.
    ///
    /// ✕ **Nothing else is accepted.** No exponent, no thousands separator, no
    /// leading `+` on the digits of a fraction. §4.8 enumerates the form as
    /// "the digits, an optional sign, and an optional decimal point", and a
    /// parser that accepted more would accept values the other side of the
    /// boundary is not obliged to produce or understand.
    pub fn parse(s: &str) -> Option<Self> {
        let bytes = s.as_bytes();
        if bytes.is_empty() {
            return None;
        }
        let mut i = 0;
        let mut neg = false;
        if bytes[0] == b'-' {
            neg = true;
            i = 1;
        } else if bytes[0] == b'+' {
            i = 1;
        }
        let mut digits: Vec<u8> = Vec::new();
        let mut scale: u32 = 0;
        let mut seen_point = false;
        let mut seen_digit = false;
        while i < bytes.len() {
            let b = bytes[i];
            if b == b'.' {
                // ✕ A second point, or a trailing point with no fraction, is
                // not the boundary form.
                if seen_point {
                    return None;
                }
                // ⚠ A LEADING POINT IS REFUSED, AND THE SPECIFICATION DOES NOT
                // SAY. §4.8 gives the form as "the digits, an optional sign,
                // and an optional decimal point" without settling whether
                // `.5` is admissible.
                //
                // ➕ Refused here for a reason that comes from §4.8's own
                // purpose rather than its letter: `to_string` emits `0.5` and
                // never `.5`, so admitting the leading form would make the
                // boundary representation **non-canonical** — one side could
                // emit a string the other would not, which is the divergence
                // the clause exists to prevent. *Recorded as a conformance
                // question rather than treated as settled.*
                if !seen_digit {
                    return None;
                }
                seen_point = true;
            } else if b.is_ascii_digit() {
                seen_digit = true;
                digits.push(b - b'0');
                if seen_point {
                    scale = scale.checked_add(1)?;
                }
            } else {
                return None;
            }
            i += 1;
        }
        if !seen_digit {
            return None;
        }
        // A point must be followed by at least one digit: "1." is not a form
        // §4.8 produces, and accepting it would make the scale ambiguous.
        if seen_point && scale == 0 {
            return None;
        }
        let mut d = Decimal { neg, digits, scale };
        d.trim_leading();
        Some(d)
    }

    /// §4.8 — render the boundary form, **with the scale carried by the digits
    /// present**. ⚠ So a value at scale 2 prints `1.50`, not `1.5`: the clause
    /// says the digits carry the scale, which means they must all be there.
    pub fn to_string(&self) -> String {
        let n = self.digits.len() as i64;
        let scale = self.scale as i64;
        let mut out = String::new();
        if self.is_negative() {
            out.push('-');
        }
        if scale == 0 {
            if self.digits.is_empty() {
                out.push('0');
            } else {
                for d in &self.digits {
                    out.push((b'0' + d) as char);
                }
            }
            return out;
        }
        // Integer part, which may be absent and is then a single zero.
        if n > scale {
            for d in &self.digits[..(n - scale) as usize] {
                out.push((b'0' + d) as char);
            }
        } else {
            out.push('0');
        }
        out.push('.');
        // Leading zeros of the fraction, where the value is smaller than the
        // scale's first place.
        for _ in 0..(scale - n).max(0) {
            out.push('0');
        }
        let start = (n - scale).max(0) as usize;
        for d in &self.digits[start..] {
            out.push((b'0' + d) as char);
        }
        out
    }

    fn trim_leading(&mut self) {
        let mut cut = 0;
        while cut < self.digits.len() && self.digits[cut] == 0 {
            cut += 1;
        }
        self.digits.drain(..cut);
        if self.digits.is_empty() {
            self.neg = false;
        }
    }

    /// The digits of |self| as if written at `scale`, most significant first.
    /// Used to bring two values to a common scale for addition and comparison
    /// **without rounding either of them** (§4.4).
    fn digits_at(&self, scale: u32) -> Vec<u8> {
        debug_assert!(scale >= self.scale);
        let mut v = self.digits.clone();
        for _ in 0..(scale - self.scale) {
            v.push(0);
        }
        v
    }

    /// §4.6 — exact comparison over the values as held.
    ///
    /// ⚠ **THIS COMPARES VALUES, NOT REPRESENTATIONS, and the specification is
    /// genuinely ambiguous about whether that is right.** §4.6 says comparison
    /// is "exact over the values as held, at whatever scale each carries",
    /// which reads as: bring them to a common scale **without rounding** and
    /// compare — so `1.50` equals `1.5`. ✕ But §4.8's rationale says "scale is
    /// semantically significant and `1.50` is not `1.5`".
    ///
    /// ➕ Those two statements are about different things — §4.8 is about not
    /// LOSING scale in transmission, §4.6 about not ROUNDING before comparing —
    /// and this implementation reads them that way. **It is flagged rather than
    /// assumed**: if `equals` is meant to be scale-sensitive, this is the line
    /// that changes, and a conformance vector would catch it.
    pub fn cmp_exact(&self, other: &Decimal) -> Ordering {
        let a_neg = self.is_negative();
        let b_neg = other.is_negative();
        if a_neg != b_neg {
            return if a_neg { Ordering::Less } else { Ordering::Greater };
        }
        let scale = self.scale.max(other.scale);
        let a = self.digits_at(scale);
        let b = other.digits_at(scale);
        let mag = cmp_mag(&a, &b);
        if a_neg {
            mag.reverse()
        } else {
            mag
        }
    }

    pub fn add(&self, other: &Decimal) -> Decimal {
        // §4.4 — no rounding: the result's scale is the wider of the two, which
        // is the scale the exact sum occupies.
        let scale = self.scale.max(other.scale);
        let a = self.digits_at(scale);
        let b = other.digits_at(scale);
        let (digits, neg) = if self.is_negative() == other.is_negative() {
            (add_mag(&a, &b), self.is_negative())
        } else {
            match cmp_mag(&a, &b) {
                Ordering::Equal => (Vec::new(), false),
                Ordering::Greater => (sub_mag(&a, &b), self.is_negative()),
                Ordering::Less => (sub_mag(&b, &a), other.is_negative()),
            }
        };
        let mut d = Decimal { neg, digits, scale };
        d.trim_leading();
        d
    }

    pub fn neg(&self) -> Decimal {
        if self.is_zero() {
            return self.clone();
        }
        Decimal { neg: !self.neg, digits: self.digits.clone(), scale: self.scale }
    }

    pub fn sub(&self, other: &Decimal) -> Decimal {
        self.add(&other.neg())
    }

    pub fn abs(&self) -> Decimal {
        Decimal { neg: false, digits: self.digits.clone(), scale: self.scale }
    }

    /// §4.4 — exact product. The scale is the sum of the operands' scales,
    /// which is what the exact arithmetic produces.
    pub fn mul(&self, other: &Decimal) -> Decimal {
        if self.is_zero() || other.is_zero() {
            return Decimal::zero(self.scale + other.scale);
        }
        let mut acc = vec![0u8; self.digits.len() + other.digits.len()];
        for (i, &a) in self.digits.iter().rev().enumerate() {
            let mut carry = 0u16;
            for (j, &b) in other.digits.iter().rev().enumerate() {
                let at = acc.len() - 1 - (i + j);
                let t = acc[at] as u16 + a as u16 * b as u16 + carry;
                acc[at] = (t % 10) as u8;
                carry = t / 10;
            }
            let mut at = acc.len() - 1 - (i + other.digits.len());
            while carry > 0 {
                let t = acc[at] as u16 + carry;
                acc[at] = (t % 10) as u8;
                carry = t / 10;
                if at == 0 {
                    break;
                }
                at -= 1;
            }
        }
        let mut d = Decimal {
            neg: self.is_negative() != other.is_negative(),
            digits: acc,
            scale: self.scale + other.scale,
        };
        d.trim_leading();
        d
    }

    /// §4.5 — `÷` at a stated scale, rounded **half away from zero**.
    /// §4.7 — division by zero yields *no value*, returned here as `None`.
    ///
    /// ⚠ **`scale` IS A PARAMETER, AND THAT IS A FINDING RATHER THAN A DESIGN
    /// CHOICE.** §4.5 says `÷` yields a result "at `N-D1`'s scale — four
    /// decimal places beyond the currency's **minor unit**". **The minor unit
    /// is a property of a currency** (two for sterling, none for the yen), so
    /// `N-D1`'s scale is not a constant and cannot be one. ✕ **Nothing in the
    /// specification threads a currency into expression evaluation**, and §8's
    /// operand list does not carry one. *So the caller must supply the scale,
    /// and where it comes from is an open question — recorded, not invented.*
    pub fn div(&self, other: &Decimal, scale: u32) -> Option<Decimal> {
        if other.is_zero() {
            return None; // §4.7
        }
        if self.is_zero() {
            return Some(Decimal::zero(scale));
        }
        // Work one place beyond the target so the discarded digit decides the
        // rounding, then round half away from zero.
        let guard = scale + 1;
        // numerator scaled so that quotient digits land at `guard`
        let shift = guard + other.scale;
        let mut num = self.digits.clone();
        for _ in 0..(shift.saturating_sub(self.scale)) {
            num.push(0);
        }
        // If self.scale exceeded the shift we would have to discard digits,
        // which would be a rounding this function has not been asked for.
        debug_assert!(self.scale <= shift);
        let den = other.digits.clone();
        let q = div_mag(&num, &den);
        let mut d = Decimal {
            neg: self.is_negative() != other.is_negative(),
            digits: q,
            scale: guard,
        };
        d.trim_leading();
        Some(d.round(scale))
    }

    /// §8.4 — `round` to *n* places, **half away from zero**.
    ///
    /// ⚠ §8.3 dimension 3 tests "the **boundary**, and **negative values** —
    /// where *half away from zero* and *half up* give different answers", so
    /// −0.5 to 0 places is −1 here, not 0.
    pub fn round(&self, places: u32) -> Decimal {
        if places >= self.scale {
            // Widening is exact: pad with zeros, round nothing.
            let digits = self.digits_at(places);
            let mut d = Decimal { neg: self.neg, digits, scale: places };
            d.trim_leading();
            return d;
        }
        let drop = (self.scale - places) as usize;
        let keep_len = self.digits.len().saturating_sub(drop);
        let kept = self.digits[..keep_len].to_vec();
        // The first discarded digit decides, and only it: half away from zero
        // looks at whether the discarded tail is >= one half of the place.
        let first_dropped = self.digits[keep_len];
        let mut digits = kept;
        if first_dropped >= 5 {
            digits = add_mag(&digits, &[1]);
        }
        let mut d = Decimal { neg: self.neg, digits, scale: places };
        d.trim_leading();
        d
    }
}

impl PartialEq for Decimal {
    fn eq(&self, other: &Self) -> bool {
        self.cmp_exact(other) == Ordering::Equal
    }
}
impl Eq for Decimal {}

// ---------------------------------------------------------------- magnitudes
//
// Plain base-10 digit arithmetic. ➕ Base 10 rather than a packed radix because
// the specification's unit of meaning is the decimal digit — the scale counts
// decimal places, §4.8 transmits decimal digits, and `round` acts on a decimal
// place. *A packed radix would be faster and would need converting back at
// every boundary the specification defines.*

fn cmp_mag(a: &[u8], b: &[u8]) -> Ordering {
    let a = strip(a);
    let b = strip(b);
    if a.len() != b.len() {
        return a.len().cmp(&b.len());
    }
    a.cmp(b)
}

fn strip(a: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < a.len() && a[i] == 0 {
        i += 1;
    }
    &a[i..]
}

fn add_mag(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len().max(b.len()) + 1);
    let mut carry = 0u8;
    let (mut i, mut j) = (a.len(), b.len());
    while i > 0 || j > 0 || carry > 0 {
        let mut t = carry;
        if i > 0 {
            i -= 1;
            t += a[i];
        }
        if j > 0 {
            j -= 1;
            t += b[j];
        }
        out.push(t % 10);
        carry = t / 10;
    }
    out.reverse();
    out
}

/// Requires |a| >= |b|.
fn sub_mag(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len());
    let mut borrow = 0i8;
    let (mut i, mut j) = (a.len(), b.len());
    while i > 0 {
        i -= 1;
        let bv = if j > 0 {
            j -= 1;
            b[j] as i8
        } else {
            0
        };
        let mut t = a[i] as i8 - bv - borrow;
        if t < 0 {
            t += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out.push(t as u8);
    }
    out.reverse();
    out
}

/// Long division of magnitudes, truncating. The caller positions the operands
/// so the quotient's digits land at the scale it wants.
fn div_mag(num: &[u8], den: &[u8]) -> Vec<u8> {
    let den = strip(den);
    let mut q: Vec<u8> = Vec::with_capacity(num.len());
    let mut rem: Vec<u8> = Vec::new();
    for &d in num {
        rem.push(d);
        let r = strip(&rem).to_vec();
        rem = r;
        // At most nine subtractions, which is why this needs no estimation.
        let mut digit = 0u8;
        while cmp_mag(&rem, den) != Ordering::Less {
            rem = sub_mag(&rem, den);
            let r = strip(&rem).to_vec();
            rem = r;
            digit += 1;
        }
        q.push(digit);
    }
    q
}
