//! ADR-005 §4.4a's **one** evaluator, built against the **Antarii Condition
//! Language Specification v1.2** (NORMATIVE).
//!
//! 🔴 WHAT THIS IS AND IS NOT, because the distinction decides what may be
//! measured with it.
//!
//! **Condition 6** of the spike brief — the guard/rule evaluator meeting
//! `SwR-066`'s **300 ms** on each baseline device, offline — is what this
//! crate is for. ✕ **Condition 7, the pricing resolver, is NOT here and
//! cannot be**: the run plan's `O5` found it has no normative artefact, and
//! that was re-verified at source on 2026-10-28 — `tier`, `SwR-032`,
//! `SwR-019` and `SwR-036` appear in the specification **zero times each**.
//! *Writing a resolver would mean inventing the thing it must conform to.*
//!
//! ⚠ **AND THE 300 ms FIGURE CANNOT BE TAKEN IN A CONTAINER.** `SwR-066` binds
//! it "on each supported platform's baseline device". What the container
//! proves is **conformance**; the figure needs the device, a cross-compile and
//! ADR-003 §4.6's hosting — *which is the part nobody has exercised yet.*

// ===========================================================================
// 🔴 FROZEN 2026-10-29 — A CORRECTNESS REFERENCE, NOT THE PROBE.
//
// *(Author's recommendation on the owner's go ahead. The owner named no
// option, so the attribution convention applies.)*
//
// `decimal`, `value` and `datetime` are **complete for what they cover and
// will not be extended**. §§5, 7–11 are deliberately NOT written here.
//
// ---------------------------------------------------------------------------
// WHY, IN THE BRIEF'S OWN WORDS.
//
// Brief §2: *"The spike's code is throwaway and lives outside the
// repositories… **what returns from it is numbers and a record, not code**…
// If a pattern from the spike is worth keeping, it is **re-written** in the
// client repository when construction starts."*
//
// ✕ **And `SB-019` named this exact artefact**: *"on a yes, ADR-012 §10.8
// rule 1 puts that one evaluator implementation in the shared front-end
// package — **so the artefact thrown away is precisely the thing someone then
// writes again, properly**."*
//
// 🔴 **This was written properly the first time, in the tree that gets thrown
// away.** Arbitrary-precision arithmetic, canonical boundary forms, exactness
// to thirty digits — all correct, none of it what the spike was asked for.
// *The question is "can this arithmetic hit 300 ms on a mid-range phone",
// which needs arithmetic that is REPRESENTATIVE, not arithmetic that is RIGHT.*
//
// ✅ **IT HAS EARNED ITS KEEP, AND THAT IS WHY IT IS FROZEN RATHER THAN
// DELETED.** It produced exactly what the brief asks a spike to return — a
// record: **`F-11`'s three specification gaps**, none of which was visible
// from reading the specification, and all three of which are free to fix now
// and cost a version increment plus a floor wait later (§13.2).
//
// ---------------------------------------------------------------------------
// WHAT REPLACES IT, AND WHAT IT MUST MEASURE.
//
// `O5` option (a): *"a throwaway evaluator whose arithmetic is **explicitly
// sized to those clauses**, and say so in the record"* — sized to `SwR-032`'s
// four tiers and `SwR-019`'s twelve record fields. ✕ **Not option (d)**,
// *"a simpler evaluator… would return a number that passes and means
// nothing"*.
//
// ⚠ **AND IT MUST BE MEASURED ACROSS THE JS↔NATIVE BOUNDARY, which the corpus
// asks for in terms.** Specification §4.8: *"parsing and formatting a string
// per value per re-evaluation is real work against `SwR-066`'s 300 ms… it
// needs no separate experiment: **condition 6 measures exactly this**."*
// *A figure taken inside Rust alone would miss the cost the corpus flagged.*
//
// 🔴 **NEITHER CAN RUN UNTIL HOSTING EXISTS.** Nothing has run Rust inside
// this client; the earlier Go→WebAssembly attempt was reverted. **Re-scoping
// makes the code smaller and does not touch that blocker.**
// ===========================================================================

pub mod datetime;
pub mod decimal;
/// `SC-10`'s C boundary. ⚠ Added AFTER the freeze and permitted by it: the
/// freeze forbids **extending** the evaluator's specification coverage, and
/// this adds none — it puts a boundary around what already exists, because
/// §4.8 names *"JavaScript ↔ the native library on the device"* as a boundary
/// a decimal must cross as a string.
pub mod ffi;
pub mod value;

#[cfg(test)]
mod ffi_tests {
    use super::ffi::*;
    use std::ffi::{CStr, CString};

    #[test]
    fn the_linkage_probe_cannot_panic_even_at_the_limits() {
        // ➕ `wrapping_add`, so a debug build does not abort on overflow — a
        // probe that panics cannot be told from a library that failed to load.
        assert_eq!(antarii_probe_add(2, 3), 5);
        assert_eq!(antarii_probe_add(-1, 1), 0);
        assert_eq!(antarii_probe_add(i64::MAX, 1), i64::MIN);
        assert_eq!(antarii_probe_add(i64::MIN, -1), i64::MAX);
    }

    #[test]
    fn the_decimal_contract_survives_a_round_trip_with_its_scale() {
        // §4.8: the scale is carried by the digits present, so doubling a
        // 2-place value must come back with 2 places — not tidied to 1.
        assert_eq!(double_decimal("1.50").unwrap(), "3.00");
        assert_eq!(double_decimal("0.05").unwrap(), "0.10");
        assert_eq!(double_decimal("-2.5").unwrap(), "-5.0");
        assert_eq!(double_decimal("0").unwrap(), "0");
        // and a width no fixed mantissa would hold
        assert_eq!(
            double_decimal("123456789012345678901234567890").unwrap(),
            "246913578024691357802469135780"
        );
    }

    #[test]
    fn a_value_this_boundary_does_not_accept_is_a_result_not_a_crash() {
        // ⚠ §4.8's form only. An exponent is how a binary float prints itself,
        // and admitting it would be the representation §4.1 forbids.
        for bad in ["1e5", "", ".5", "1.", "abc", "1,5"] {
            assert!(double_decimal(bad).is_none(), "{bad} must be refused");
        }
    }

    #[test]
    fn the_c_boundary_round_trips_and_frees_without_leaking_ownership() {
        // The whole contract in one test: in as C, out as C, freed by the
        // allocator that allocated — never by the host's `free()`.
        let input = CString::new("12.3456").expect("no interior NUL");
        unsafe {
            let out = antarii_probe_double_decimal(input.as_ptr());
            assert!(!out.is_null(), "a valid decimal must produce a string");
            let got = CStr::from_ptr(out).to_str().expect("valid UTF-8 out");
            assert_eq!(got, "24.6912");
            antarii_probe_free(out);
            // ✅ Freeing null is defined and harmless, which the host relies on
            // when the previous call returned null.
            antarii_probe_free(std::ptr::null_mut());
        }
    }

    #[test]
    fn null_in_is_null_out_rather_than_undefined_behaviour() {
        unsafe {
            assert!(antarii_probe_double_decimal(std::ptr::null()).is_null());
        }
        // And a refused value returns null too, so the host has one check.
        let bad = CString::new("1e5").unwrap();
        unsafe {
            assert!(antarii_probe_double_decimal(bad.as_ptr()).is_null());
        }
    }
}

#[cfg(test)]
mod datetime_tests {
    use super::datetime::*;

    fn d(y: i32, m: u8, dd: u8) -> CivilDate {
        CivilDate::new(y, m, dd).expect("a real date")
    }
    fn t(h: u8, mi: u8, s: u8) -> CivilTime {
        CivilTime::new(h, mi, s).expect("a real time")
    }

    #[test]
    fn an_impossible_date_is_refused_rather_than_normalised() {
        // ⚠ Rolling 31 February forward to 3 March would make a designer's
        // mistake invisible, and nothing in §6 licenses it.
        assert!(CivilDate::new(2026, 2, 30).is_none());
        assert!(CivilDate::new(2026, 13, 1).is_none());
        assert!(CivilDate::new(2026, 0, 1).is_none());
        assert!(CivilDate::new(2026, 1, 0).is_none());
        assert!(CivilTime::new(24, 0, 0).is_none());
        assert!(CivilTime::new(0, 60, 0).is_none());
        // and the leap year that catches the naive rule
        assert!(CivilDate::new(2024, 2, 29).is_some());
        assert!(CivilDate::new(2100, 2, 29).is_none(), "2100 is not a leap year");
        assert!(CivilDate::new(2000, 2, 29).is_some(), "2000 is");
    }

    #[test]
    fn date_difference_is_a_minus_b_so_overdue_is_positive() {
        // §6.3: "the reading that makes 'due date − today' positive while
        // overdue, which is SwR-164's built-in first rule".
        let due = d(2026, 10, 20);
        let today = d(2026, 10, 28);
        // today is past due, so due − today is negative; the rule the
        // specification names is `today − due` being positive when overdue.
        assert_eq!(date_difference(today, due).to_string(), "8");
        assert_eq!(date_difference(due, today).to_string(), "-8");
    }

    #[test]
    fn date_difference_counts_calendar_days_across_a_month_and_a_year() {
        assert_eq!(date_difference(d(2026, 3, 1), d(2026, 2, 28)).to_string(), "1");
        assert_eq!(date_difference(d(2024, 3, 1), d(2024, 2, 28)).to_string(), "2");
        assert_eq!(date_difference(d(2027, 1, 1), d(2026, 12, 31)).to_string(), "1");
        assert_eq!(date_difference(d(2026, 1, 1), d(2025, 1, 1)).to_string(), "365");
        assert_eq!(date_difference(d(2025, 1, 1), d(2024, 1, 1)).to_string(), "366");
    }

    #[test]
    fn a_daylight_saving_day_counts_as_one_day() {
        // 🔴 §6.3's decisive case. In the United Kingdom clocks went back on
        // 2026-10-25, making that day 25 hours long. §6.3: "a daylight-saving
        // day counts as one day", and "the alternative makes a 23-hour day
        // arithmetically zero days, which no designer intends".
        //
        // ✅ It holds BY CONSTRUCTION here, because civil dates carry no
        // offset — which is the argument for taking already-zoned values.
        assert_eq!(date_difference(d(2026, 10, 26), d(2026, 10, 25)).to_string(), "1");
        assert_eq!(date_difference(d(2026, 3, 30), d(2026, 3, 29)).to_string(), "1");
    }

    #[test]
    fn date_and_time_difference_are_not_interconvertible_and_that_is_by_design() {
        // §6.3: "24 × date difference ≠ time difference / 60 across a DST
        // boundary, by design". The two operators answer different questions,
        // and this asserts the shapes rather than the equality.
        let one_day = date_difference(d(2026, 10, 26), d(2026, 10, 25));
        assert_eq!(one_day.to_string(), "1");
        // A time difference is within a day and never carries a date, so there
        // is no quantity here to convert in the first place.
        assert_eq!(time_difference(t(23, 0, 0), t(1, 0, 0)).to_string(), "1320");
    }

    #[test]
    fn time_difference_is_minutes_truncated_toward_zero() {
        // §6.3: "a 90-second difference is 1 or 2" — it is 1, because
        // truncation toward zero is not rounding.
        assert_eq!(time_difference(t(10, 1, 30), t(10, 0, 0)).to_string(), "1");
        assert_eq!(time_difference(t(10, 0, 0), t(10, 1, 30)).to_string(), "-1");
        assert_eq!(time_difference(t(10, 0, 59), t(10, 0, 0)).to_string(), "0");
        assert_eq!(time_difference(t(10, 0, 0), t(10, 0, 59)).to_string(), "0");
        assert_eq!(time_difference(t(12, 30, 0), t(10, 0, 0)).to_string(), "150");
    }

    #[test]
    fn truncation_toward_zero_is_not_half_away_from_zero() {
        // ⚠ The clause this guards: "an implicit rounding inside another
        // operator would be a second rounding behaviour, which §4.5 refused".
        // 30 seconds is half a minute, and `round` would make it 1 / −1.
        assert_eq!(time_difference(t(10, 0, 30), t(10, 0, 0)).to_string(), "0");
        assert_eq!(time_difference(t(10, 0, 0), t(10, 0, 30)).to_string(), "0");
    }

    #[test]
    fn between_includes_both_endpoints() {
        // §6.4, decided inclusive so that `between(min, max)` and
        // `not is out of range` cannot disagree at the boundary (§7.5).
        assert!(between_ord(d(2026, 1, 1), d(2026, 1, 1), d(2026, 1, 31)));
        assert!(between_ord(d(2026, 1, 31), d(2026, 1, 1), d(2026, 1, 31)));
        assert!(!between_ord(d(2025, 12, 31), d(2026, 1, 1), d(2026, 1, 31)));
        assert!(between_ord(t(9, 0, 0), t(9, 0, 0), t(17, 0, 0)));
        assert!(between_ord(t(17, 0, 0), t(9, 0, 0), t(17, 0, 0)));
    }

    #[test]
    fn between_over_numbers_uses_the_exact_comparison() {
        use super::decimal::Decimal;
        let v = |s: &str| Decimal::parse(s).unwrap();
        assert!(between_number(&v("10"), &v("10"), &v("20")));
        assert!(between_number(&v("20.0000"), &v("10"), &v("20")));
        assert!(!between_number(&v("20.0001"), &v("10"), &v("20")));
        assert!(between_number(&v("10.0000"), &v("10"), &v("20")));
    }

    #[test]
    fn endpoints_the_wrong_way_round_are_false_not_swapped() {
        // ⚠ Swapping would hide a designer's mistake, and §6.4 does not
        // license reinterpreting the operands.
        assert!(!between_ord(d(2026, 1, 15), d(2026, 1, 31), d(2026, 1, 1)));
    }

    #[test]
    fn the_day_number_is_right_at_the_epoch_and_before_it() {
        // The algorithm is the load-bearing part of every difference above, so
        // it is checked against known values rather than only against itself.
        assert_eq!(d(1970, 1, 1).to_days(), 0);
        assert_eq!(d(1969, 12, 31).to_days(), -1);
        assert_eq!(d(2000, 1, 1).to_days(), 10_957);
        assert_eq!(d(2026, 10, 28).to_days(), 20_754);
    }
}

#[cfg(test)]
mod value_tests {
    use super::datetime::CivilDate;
    use super::decimal::Decimal;
    use super::value::*;
    use std::collections::BTreeSet;

    #[test]
    fn no_value_is_neither_an_error_nor_zero() {
        // §3.3, and SwR-068's "yields no value (never zero)".
        assert!(!Value::NoValue.is_answered());
        assert_ne!(Value::NoValue, Value::Number(Decimal::parse("0").unwrap()));
        assert!(Value::NoValue.as_expression_number().is_none());
        // ✅ And zero IS answered, which is the other half of the same clause.
        assert!(Value::Number(Decimal::parse("0").unwrap()).is_answered());
    }

    #[test]
    fn a_checkbox_is_zero_or_one_in_an_expression_but_not_a_number_elsewhere() {
        // §8's operand list: "checkbox as 0/1". §7.1 gives it `is checked`
        // only, so it is a distinct variant rather than a Number.
        assert_eq!(
            Value::Checkbox(true).as_expression_number().unwrap().to_string(),
            "1"
        );
        assert_eq!(
            Value::Checkbox(false).as_expression_number().unwrap().to_string(),
            "0"
        );
        assert!(Value::Checkbox(false).is_answered(), "false is an answer");
    }

    #[test]
    fn a_hidden_field_counts_as_unanswered_to_everything_that_reads_it() {
        // §3.4 — "shall not be required, validated, or used as an input to
        // calculations (it counts as unanswered)".
        let mut f = Field::answered(Value::Number(Decimal::parse("42").unwrap()));
        f.hidden = true;
        assert_eq!(f.effective(Shape::InProgressOnDevice), Value::NoValue);
        assert_eq!(f.effective(Shape::SubmittedRecord), Value::NoValue);
    }

    #[test]
    fn but_the_device_keeps_the_value_while_the_record_does_not() {
        // 🔴 §3.4a, and ADR-005 §8.3 dimension 9. The device keeps it,
        // "restored if re-shown"; the submitted record holds "not applicable
        // with no value". **Two shapes of one instance, not a divergence.**
        let mut f = Field::answered(Value::Number(Decimal::parse("42").unwrap()));
        f.hidden = true;
        assert_eq!(
            f.recorded(Shape::InProgressOnDevice),
            Value::Number(Decimal::parse("42").unwrap()),
            "the device keeps it for restoration"
        );
        assert_eq!(
            f.recorded(Shape::SubmittedRecord),
            Value::NoValue,
            "the submitted record does not"
        );
    }

    #[test]
    fn a_choice_identifier_is_compared_exactly_with_no_normalisation() {
        // §5.2 — a choice option identifier is "a stable key compared
        // exactly", explicitly outside §5.1's trimming, folding and collapsing.
        // ✅ Which is why these work before §5 exists.
        assert_ne!(ChoiceId("opt-a".into()), ChoiceId("OPT-A".into()));
        assert_ne!(ChoiceId("opt-a".into()), ChoiceId(" opt-a ".into()));
        assert_eq!(ChoiceId("opt-a".into()), ChoiceId("opt-a".into()));
    }

    #[test]
    fn a_multi_select_is_a_set_so_order_and_duplicates_cannot_be_observed() {
        // §7.6 makes `equals` set equality on a multi-select, and §11.2 wants
        // set comparison to mean something.
        let a: BTreeSet<ChoiceId> =
            ["x", "y"].iter().map(|s| ChoiceId(s.to_string())).collect();
        let b: BTreeSet<ChoiceId> =
            ["y", "x", "y"].iter().map(|s| ChoiceId(s.to_string())).collect();
        assert_eq!(Value::ChoiceSet(a), Value::ChoiceSet(b));
    }

    #[test]
    fn an_empty_multi_select_is_not_the_same_as_unanswered() {
        // ⚠ A distinction nothing in §3 states, and the types must pick one.
        // An empty set is an ANSWER of "none of them"; NoValue is no answer.
        // *Flagged in F-11's company if the corpus later disagrees.*
        let empty = Value::ChoiceSet(BTreeSet::new());
        assert_ne!(empty, Value::NoValue);
        assert!(empty.is_answered());
    }

    #[test]
    fn media_carries_no_content_because_has_evidence_is_its_only_operator() {
        // §7.1 gives media exactly one operator. Holding a filename would
        // invite a text comparison the palette does not offer.
        assert!(Value::Media { present: true }.is_answered());
        assert!(Value::NoValue.as_expression_number().is_none());
    }

    #[test]
    fn a_date_is_a_value_and_not_a_number() {
        let v = Value::Date(CivilDate::new(2026, 10, 28).unwrap());
        assert!(v.is_answered());
        assert!(
            v.as_expression_number().is_none(),
            "§8's operand list admits dates via date difference, never as bare numbers"
        );
    }
}

#[cfg(test)]
mod decimal_tests {
    use super::decimal::Decimal;
    use core::cmp::Ordering;

    fn d(s: &str) -> Decimal {
        Decimal::parse(s).expect(s)
    }

    // ------------------------------------------------- §4.8 the boundary form

    #[test]
    fn scale_survives_a_round_trip_because_the_digits_carry_it() {
        // §4.8: "the scale carried by the digits present" — so a value at
        // scale 2 must come back as scale 2, not be tidied to its shortest
        // form. This is the clause that rules out a scaled integer.
        for s in ["1.50", "1.5", "0.0001", "-0.50", "0", "100", "-7"] {
            assert_eq!(d(s).to_string(), s, "round trip of {s}");
        }
    }

    #[test]
    fn leading_zeros_do_not_change_the_value_or_its_scale() {
        assert_eq!(d("007.50").to_string(), "7.50");
        assert_eq!(d("0.10").scale(), 2);
    }

    #[test]
    fn nothing_outside_the_stated_form_is_accepted() {
        // §4.8 enumerates: digits, an optional sign, an optional point.
        // ✕ An exponent is how a binary float prints itself, and admitting it
        // would be the one representation §4.1 forbids at every stage.
        for s in ["1e5", "1.2.3", "1.", ".5", "", "-", "1 000", "0x10", "1,5", "NaN"] {
            assert!(Decimal::parse(s).is_none(), "{s} must be refused");
        }
    }

    // --------------------------------------------- §4.4 exact `+ − ×`

    #[test]
    fn addition_applies_no_rounding_and_widens_to_the_wider_scale() {
        // §4.4: "no rounding is applied by the operator".
        assert_eq!(d("0.1").add(&d("0.02")).to_string(), "0.12");
        assert_eq!(d("1.5").add(&d("1.5")).to_string(), "3.0");
        assert_eq!(d("-1.5").add(&d("1.5")).to_string(), "0.0");
    }

    #[test]
    fn the_classic_binary_float_cases_must_not_appear() {
        // ADR-005 §8.3 dimension 11, quoted in §4.1. In binary floating point
        // 0.1 + 0.2 is 0.30000000000000004 — here it is 0.3, exactly.
        assert_eq!(d("0.1").add(&d("0.2")).to_string(), "0.3");
        // And the other one: 1.005 rounded to 2 places is 1.00 in binary
        // float, because 1.005 is really 1.00499999…
        assert_eq!(d("1.005").round(2).to_string(), "1.01");
    }

    #[test]
    fn subtraction_crosses_zero_correctly_in_both_directions() {
        assert_eq!(d("1.00").sub(&d("2.50")).to_string(), "-1.50");
        assert_eq!(d("-1.00").sub(&d("-2.50")).to_string(), "1.50");
        assert_eq!(d("2.50").sub(&d("2.50")).to_string(), "0.00");
    }

    #[test]
    fn multiplication_scale_is_the_sum_of_the_operand_scales() {
        // §4.4 again: the scale the exact arithmetic produces, not a rounded one.
        assert_eq!(d("1.5").mul(&d("1.5")).to_string(), "2.25");
        assert_eq!(d("0.01").mul(&d("0.01")).to_string(), "0.0001");
        assert_eq!(d("-3").mul(&d("2.5")).to_string(), "-7.5");
        assert_eq!(d("0.00").mul(&d("5.0")).to_string(), "0.000");
    }

    #[test]
    fn a_product_wider_than_any_fixed_mantissa_is_still_exact() {
        // ➕ The reason this crate carries its own arithmetic: §4.8 rejects a
        // scaled integer because "beyond 2⁵³ a `number` is lossy", and a
        // 96-bit decimal would fail here just as surely.
        let big = d("123456789012345678901234567890");
        assert_eq!(
            big.mul(&big).to_string(),
            "15241578753238836750495351562536198787501905199875019052100"
        );
    }

    // ------------------------------------------------- §4.5 and §4.7 division

    #[test]
    fn division_by_zero_is_no_value_not_an_error() {
        // §4.7, and SRS §5.2.6. `None` is this layer's *no value*.
        assert!(d("1").div(&d("0"), 6).is_none());
        assert!(d("0").div(&d("0.00"), 6).is_none());
    }

    #[test]
    fn division_lands_at_the_scale_it_is_given_half_away_from_zero() {
        // §4.5. Sterling's N-D1 scale is 2 + 4 = 6.
        assert_eq!(d("1").div(&d("3"), 6).unwrap().to_string(), "0.333333");
        assert_eq!(d("2").div(&d("3"), 6).unwrap().to_string(), "0.666667");
        assert_eq!(d("10").div(&d("4"), 6).unwrap().to_string(), "2.500000");
        // and the yen, whose minor unit is nothing, so N-D1 is 4
        assert_eq!(d("1").div(&d("3"), 4).unwrap().to_string(), "0.3333");
    }

    #[test]
    fn division_rounds_away_from_zero_on_both_signs() {
        // ⚠ The asymmetry half-up would introduce: −0.5 must go to −1, not 0.
        assert_eq!(d("-1").div(&d("2"), 0).unwrap().to_string(), "-1");
        assert_eq!(d("1").div(&d("2"), 0).unwrap().to_string(), "1");
    }

    // ------------------------------------------------- §8.4 round, and §4.6

    #[test]
    fn round_is_half_away_from_zero_at_the_boundary_and_on_negatives() {
        // §8.3 dimension 3 names exactly this case: "the boundary, and
        // negative values — where half away from zero and half up give
        // different answers".
        assert_eq!(d("0.5").round(0).to_string(), "1");
        assert_eq!(d("-0.5").round(0).to_string(), "-1");
        assert_eq!(d("1.5").round(0).to_string(), "2");
        assert_eq!(d("-1.5").round(0).to_string(), "-2");
        assert_eq!(d("2.675").round(2).to_string(), "2.68");
        assert_eq!(d("-2.675").round(2).to_string(), "-2.68");
    }

    #[test]
    fn rounding_to_a_wider_scale_changes_nothing_but_the_digits_shown() {
        assert_eq!(d("1.5").round(3).to_string(), "1.500");
        assert_eq!(d("1.5").round(3), d("1.5"));
    }

    #[test]
    fn comparison_does_not_round_either_operand_first() {
        // §4.6, and §8.3 dimension 11's "a comparison of two values that
        // differ below that scale" — which "compare as unequal, because they
        // are unequal".
        assert_eq!(d("1.0001").cmp_exact(&d("1.0002")), Ordering::Less);
        assert_ne!(d("1.0001"), d("1.0002"));
    }

    #[test]
    fn comparison_is_over_values_so_trailing_zeros_do_not_change_it() {
        // ⚠ THE AMBIGUITY THIS CRATE FLAGS. §4.6 compares "the values as
        // held"; §4.8's rationale says "1.50 is not 1.5". This asserts the
        // reading that §4.6 is about not ROUNDING and §4.8 about not LOSING
        // scale — so these are equal as values while staying distinct as
        // representations. If the corpus decides otherwise, this test is the
        // one that inverts.
        assert_eq!(d("1.50"), d("1.5"));
        assert_eq!(d("1.50").cmp_exact(&d("1.5")), Ordering::Equal);
        // ✅ And the representations remain distinguishable either way:
        assert_ne!(d("1.50").to_string(), d("1.5").to_string());
        assert_ne!(d("1.50").scale(), d("1.5").scale());
    }

    #[test]
    fn ordering_is_right_across_signs_and_scales() {
        assert_eq!(d("-0.0001").cmp_exact(&d("0")), Ordering::Less);
        assert_eq!(d("-5").cmp_exact(&d("-10")), Ordering::Greater);
        assert_eq!(d("10").cmp_exact(&d("9.9999")), Ordering::Greater);
        assert_eq!(d("0").cmp_exact(&d("-0")), Ordering::Equal);
    }

    #[test]
    fn negative_zero_cannot_be_observed() {
        // A sign on zero would make two representations of one value, and
        // §4.6's equality would then depend on which one you held.
        assert_eq!(d("-0.00").to_string(), "0.00");
        assert!(!d("-0").is_negative());
        assert_eq!(d("1.5").sub(&d("1.5")).to_string(), "0.0");
    }

    #[test]
    fn abs_and_neg_round_trip() {
        assert_eq!(d("-7.25").abs().to_string(), "7.25");
        assert_eq!(d("7.25").abs().to_string(), "7.25");
        assert_eq!(d("-7.25").neg().to_string(), "7.25");
        assert_eq!(d("0.00").neg().to_string(), "0.00");
    }

    // ----------------------------------------------------- §4.3 monetary case

    #[test]
    fn a_monetary_value_carries_four_places_beyond_the_minor_unit() {
        // §4.3 / N-D1. Sterling: 2 + 4 = 6 places, and arithmetic over such
        // values must not quietly narrow them.
        let unit = d("12.345600");
        let qty = d("3");
        assert_eq!(unit.mul(&qty).to_string(), "37.036800");
        assert_eq!(unit.add(&unit).scale(), 6);
    }
}
