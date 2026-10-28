//! §3 — The value domain.
//!
//! 🔴 **THE WHOLE POINT OF THIS MODULE IS §3.3**: *"**No value* is a
//! first-class value, not an error and not zero."* `SwR-068` puts it in the
//! requirement's own words — a calculation with an unanswered or hidden input
//! *"yields **no value** (never zero)"*.
//!
//! ⚠ So absence is a **variant**, never an `Option` wrapped round the outside
//! and never a sentinel. *An `Option<Value>` would make "unanswered" a
//! property of the slot rather than of the value, and §3.2 says every operand
//! has "exactly one of: a value of its type, or **no value**".*

use crate::datetime::{CivilDate, CivilTime};
use crate::decimal::Decimal;
use std::collections::BTreeSet;

/// A stable option identifier (`SwR-044`).
///
/// ⚠ **Compared EXACTLY, with none of §5.1's normalisation**, and §5.2 says so
/// in terms: a choice option identifier *"is a stable key compared exactly"*.
/// ✅ *Which is why choice conditions are implementable before §5's Unicode
/// work exists — they were never text comparisons.*
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ChoiceId(pub String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    /// §3.3 — first-class. **Not an error, not zero, not an empty string.**
    NoValue,
    /// `number` and `numerical reading` — §4.2, a reading behaving "as number".
    Number(Decimal),
    Text(String),
    /// `single-select` and `dropdown` — single-valued (§7.6).
    Choice(ChoiceId),
    /// `multi-select` — set-valued (§7.6).
    ///
    /// ➕ A `BTreeSet` so set equality is **unordered with no duplicates**,
    /// which §11.2 requires of the flag set for the same reason: *"must be
    /// comparable for property 1's 'outputs are equal' to mean anything"*.
    ChoiceSet(BTreeSet<ChoiceId>),
    /// `checkbox`. ⓘ §8's operand list makes it **0/1** inside an expression,
    /// which `as_expression_number` below does — but it is not a number here,
    /// because §7.1 gives it *is checked* and not the numeric operators.
    Checkbox(bool),
    Date(CivilDate),
    Time(CivilTime),
    /// §6.5 — takes the operators §5.2.3 names for *date* and *time*.
    DateTime(CivilDate, CivilTime),
    /// `file upload`, `photograph`, `video`, `signature` — §7.1 gives media
    /// exactly one operator, *has evidence*, so nothing of the content is
    /// modelled. ⚠ *Holding a filename here would invite a text comparison
    /// the palette does not offer.*
    Media { present: bool },
}

impl Value {
    /// §7.1 — *is answered* / *is unanswered*, the only operators that apply to
    /// every type.
    ///
    /// ⚠ **`Media { present: false }` IS ANSWERED-BUT-EMPTY, and that is a
    /// distinction this file makes rather than finds.** §7.1 gives media *has
    /// evidence*; §7.3 speaks of a field being *unanswered*. A media field
    /// that exists with no file is `NoValue` here, and `present: false` is
    /// reserved for a state the corpus does not currently produce. *Kept so
    /// the type cannot silently conflate the two if it later does.*
    pub fn is_answered(&self) -> bool {
        !matches!(self, Value::NoValue)
    }

    /// §8's operand list — "checkbox as 0/1", "choice fields by option
    /// identifier". Returns `NoValue`'s absence as `None` so §8.5's
    /// propagation is the caller's single decision point.
    pub fn as_expression_number(&self) -> Option<Decimal> {
        match self {
            Value::Number(d) => Some(d.clone()),
            Value::Checkbox(b) => Some(Decimal::from_i64(if *b { 1 } else { 0 }, 0)),
            _ => None,
        }
    }

    /// §3.4 — **a hidden field counts as unanswered**, "while keeping any value
    /// already entered" in progress.
    ///
    /// 🔴 **§3.4a IS WHY THIS TAKES A SHAPE ARGUMENT RATHER THAN JUST HIDING.**
    /// The device keeps the value; the server records the submitted instance
    /// with *"**not applicable** with no value"*. **So the two sides
    /// legitimately hold different shapes of one instance**, and ADR-005 §8.3
    /// dimension 9 *"requires every vector to state which of the two it
    /// evaluates"*. ✅ *"This is not a divergence under `SwR-069` — it is two
    /// different inputs."*
    pub fn as_hidden(&self, shape: Shape) -> Value {
        match shape {
            // In progress on the device: retained, restorable if re-shown —
            // but still unanswered to every rule and calculation (§3.4).
            Shape::InProgressOnDevice => self.clone(),
            Shape::SubmittedRecord => Value::NoValue,
        }
    }
}

/// §3.4a — which of the two shapes of an instance is being evaluated.
///
/// ⚠ **There is no default, deliberately.** A default would let a vector omit
/// the thing dimension 9 exists to make explicit, and the omission would look
/// like agreement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    InProgressOnDevice,
    SubmittedRecord,
}

/// §3.4 — a field as the evaluator sees it: its value, and whether a rule has
/// hidden it. ➕ Separated because "hidden" is a rule **output** that becomes an
/// **input** to everything downstream (§10.1), and conflating it with absence
/// is how §3.4's "keeps any value already entered" gets lost.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub value: Value,
    pub hidden: bool,
}

impl Field {
    pub fn answered(value: Value) -> Self {
        Field { value, hidden: false }
    }

    pub fn unanswered() -> Self {
        Field { value: Value::NoValue, hidden: false }
    }

    /// What a rule or calculation reading this field sees, under §3.4.
    ///
    /// ⚠ **`shape` IS ACCEPTED AND DELIBERATELY IGNORED, which is the clause
    /// rather than an oversight.** §3.4 makes a hidden field unanswered to
    /// everything that reads it **in both shapes** — the retention §3.4a
    /// describes is about what the instance *records*, not what a rule *sees*.
    /// ✅ *So `effective` is shape-independent and `recorded` is not, and the
    /// parameter stays in the signature so a caller cannot reach the first
    /// while believing it asked for the second.*
    pub fn effective(&self, _shape: Shape) -> Value {
        if self.hidden {
            Value::NoValue
        } else {
            self.value.clone()
        }
    }

    /// What the instance RECORDS, which is not the same thing (§3.4a).
    pub fn recorded(&self, shape: Shape) -> Value {
        if self.hidden {
            self.value.as_hidden(shape)
        } else {
            self.value.clone()
        }
    }
}
