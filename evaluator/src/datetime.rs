//! §6 — Dates, times, and the zone.
//!
//! 🔴 **THE ZONE IS NOT RESOLVED HERE, AND THAT IS A BOUNDARY DECISION WORTH
//! STATING RATHER THAN LETTING THE TYPES IMPLY IT.**
//!
//! §6.1 puts the zone beyond doubt — *"the tenant's working-calendar time
//! zone … **never the device's own**"*, read from ADR-002 §17A's local copy.
//! ⚠ But it does not say **who converts**: the evaluator, or the caller that
//! hands it values.
//!
//! ➕ **This implementation takes already-zoned civil values**, on the analogy
//! §9.4 draws for the other operands that need outside state: *"this
//! specification therefore defines the derived operands as functions of a
//! stated input tuple, and a conformance vector supplies that tuple
//! explicitly — the corpus never asks an implementation to go and find the
//! related records itself."* **A zone database is the same kind of outside
//! state as a related record.**
//!
//! ✅ **And it is what makes §6.3's calendar rule implementable at all.** Once
//! the values are civil dates in the tenant's zone, *"a daylight-saving day
//! counts as one day"* falls out by construction: the arithmetic never sees an
//! offset, so it cannot be misled by one. *An implementation holding instants
//! and converting internally would need the tz database to get the same
//! answer, and would get a different one wherever its copy disagreed.*
//!
//! ⚠ **Flagged, not assumed settled** — if the corpus means the evaluator to
//! own the conversion, this module gains a dependency and §6.1 gains an input.

use crate::decimal::Decimal;

/// A date in the tenant's working-calendar zone (§6.1). No offset, by design.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CivilDate {
    pub y: i32,
    pub m: u8,
    pub d: u8,
}

/// A time of day in the tenant's zone. Seconds are carried because a `time`
/// field may hold them, while §6.2 makes the *difference* a count of minutes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CivilTime {
    pub h: u8,
    pub min: u8,
    pub s: u8,
}

impl CivilDate {
    pub fn new(y: i32, m: u8, d: u8) -> Option<Self> {
        if m < 1 || m > 12 || d < 1 || d > days_in_month(y, m) {
            return None;
        }
        Some(CivilDate { y, m, d })
    }

    /// Days since 1970-01-01. Howard Hinnant's civil-from-days algorithm,
    /// which is exact for the whole proleptic Gregorian range and needs no
    /// table. ➕ Chosen because §6.3 makes the difference a **calendar**
    /// operation, and a day number is exactly what a calendar difference is.
    pub fn to_days(self) -> i64 {
        let y = self.y as i64 - if self.m <= 2 { 1 } else { 0 };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400; // [0, 399]
        let m = self.m as i64;
        let d = self.d as i64;
        let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }
}

impl CivilTime {
    pub fn new(h: u8, min: u8, s: u8) -> Option<Self> {
        if h > 23 || min > 59 || s > 59 {
            return None;
        }
        Some(CivilTime { h, min, s })
    }

    fn to_seconds(self) -> i64 {
        self.h as i64 * 3600 + self.min as i64 * 60 + self.s as i64
    }
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i32, m: u8) -> u8 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// §6.2 — *date difference* is in days. §6.3 — **`difference(a, b) = a − b`**,
/// in **calendar days in the tenant's zone**, a daylight-saving day counting
/// as one day.
///
/// ➕ **The argument order is the specification's and it is not arbitrary**: it
/// is *"the reading that makes 'due date − today' positive while overdue,
/// which is `SwR-164`'s built-in first rule and therefore the common case"*.
///
/// ⚠ **A whole number of days, so the result's scale is 0.** It is a `Decimal`
/// rather than an integer because every number in this language is one, and
/// mixing representations is how a binary float gets in (§4.1).
pub fn date_difference(a: CivilDate, b: CivilDate) -> Decimal {
    let days = a.to_days() - b.to_days();
    Decimal::from_i64(days, 0)
}

/// §6.2 — *time difference* is in minutes. §6.3 — **truncates toward zero**.
///
/// ⚠ **TOWARD ZERO, NOT HALF-AWAY-FROM-ZERO**, and the distinction is the
/// specification's own reasoning: *"`round`'s half-away-from-zero is an
/// **explicit operator**; an implicit rounding inside another operator would
/// be a **second rounding behaviour**, which §4.5 just refused."*
///
/// ➕ So a 90-second difference is **1 minute**, and −90 seconds is **−1** —
/// not 2 and −2. *§6.3's own table names this case: "a 90-second difference is
/// 1 or 2".*
pub fn time_difference(a: CivilTime, b: CivilTime) -> Decimal {
    let secs = a.to_seconds() - b.to_seconds();
    // Rust's integer division truncates toward zero, which is the rule here —
    // asserted by test rather than relied on silently.
    Decimal::from_i64(secs / 60, 0)
}

/// §6.4 — *between* is **inclusive of both endpoints**.
///
/// ➕ The specification's reason, which is a consistency argument rather than a
/// preference: `SwR-049` gives a reading an *expected range* and `SwR-051`
/// *"minimum and maximum value"*, **both inclusive**, and *is out of range* is
/// defined against that same range (§7.5). ⚠ *"An exclusive between would make
/// between(min, max) and not is out of range disagree at the endpoints on the
/// same field."*
pub fn between_ord<T: Ord>(v: T, lo: T, hi: T) -> bool {
    // ⚠ Endpoints given the wrong way round yield false rather than being
    // silently swapped. Swapping would make a designer's mistake invisible,
    // and nothing in §6.4 licenses reinterpreting the operands.
    lo <= v && v <= hi
}

/// §6.4 over numbers, where ordering is §4.6's exact comparison rather than
/// `Ord` — so this cannot share the generic above.
pub fn between_number(v: &Decimal, lo: &Decimal, hi: &Decimal) -> bool {
    v.cmp_exact(lo) != core::cmp::Ordering::Less
        && v.cmp_exact(hi) != core::cmp::Ordering::Greater
}
