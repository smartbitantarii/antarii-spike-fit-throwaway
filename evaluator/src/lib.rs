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

pub mod decimal;

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
