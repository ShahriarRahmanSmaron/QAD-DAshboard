"""Workbook formula evaluation (MD07-2B: formula value persistence).

The workbook parser stores formula cells with ``value=None`` (it loads the
workbook with ``data_only=False`` to preserve formula text and fidelity). The
operational layer, however, must aggregate *evaluated numeric values* — a
``=SUM(E5:E14)`` cell has to contribute ``18729`` to queries, not the literal
formula string.

This module computes the evaluated numeric value of a formula cell from the
sheet's own cell grid, without re-opening the workbook or touching the parser.
It supports the arithmetic operational workbooks actually use:

* cell references (``E15``), same-sheet only
* ranges inside aggregate functions (``SUM(E5:E14)``)
* aggregate functions ``SUM`` / ``AVERAGE`` / ``MIN`` / ``MAX`` / ``COUNT``
* ``+ - * /`` arithmetic and parentheses
* references to *other formula cells* (resolved recursively, with cycle
  protection and memoization)

Anything it cannot safely evaluate (cross-sheet references, unknown functions,
malformed expressions) yields ``None`` so the caller can fall back to the
cached value or leave the fact blank — never a crash and never a wrong number.

There are no business values or workbook-specific names here; the evaluator is
purely structural and reusable across workbook formats.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

CellKey = tuple[int, int]
JsonObject = dict[str, Any]

# A1-style single cell reference (optional ``$`` absolute markers, up to 3
# column letters / 7 row digits) — generous enough for any real workbook.
_CELL_RE = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d{1,7})")
# A range reference ``A1:B2`` used inside aggregate functions.
_RANGE_RE = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d{1,7}):\$?([A-Za-z]{1,3})\$?(\d{1,7})")
# Innermost aggregate function call (no nested parens in the captured args).
_FUNC_RE = re.compile(r"(SUM|AVERAGE|AVG|MIN|MAX|COUNT)\s*\(([^()]*)\)", re.IGNORECASE)
# After substitution an expression must contain only arithmetic characters.
_SAFE_EXPR_RE = re.compile(r"^[0-9.\s+\-*/()]*$")
_NUMBER_RE = re.compile(r"^-?\d+(?:,\d{3})*(?:\.\d+)?$")

_MAX_RANGE_CELLS = 100_000


def _col_to_index(letters: str) -> int:
    index = 0
    for char in letters.upper():
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index


def _num_str(value: Decimal) -> str:
    """Plain decimal string (never scientific notation) for safe re-parsing."""
    return format(value, "f")


def _coerce_literal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, datetime | date):
        return None
    text = str(value).strip()
    if not text or text.startswith("="):
        return None
    cleaned = text.replace(",", "")
    if not _NUMBER_RE.match(text) and not _NUMBER_RE.match(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


class SheetFormulaEvaluator:
    """Evaluates formula cells against a single sheet's cell grid."""

    def __init__(self, cells: dict[CellKey, JsonObject]) -> None:
        self._values: dict[CellKey, Any] = {}
        self._formulas: dict[CellKey, str] = {}
        for (row, column), cell in cells.items():
            formula = cell.get("formula")
            if isinstance(formula, str) and formula.strip().startswith("="):
                self._formulas[(row, column)] = formula.strip()
            self._values[(row, column)] = cell.get("value")
        self._cache: dict[CellKey, Decimal | None] = {}
        self._in_progress: set[CellKey] = set()

    # -- public API --------------------------------------------------------

    def has_formula(self, row: int, column: int) -> bool:
        return (row, column) in self._formulas

    def evaluate(self, row: int, column: int) -> Decimal | None:
        """Return the evaluated numeric value of a cell, or ``None``."""
        key = (row, column)
        if key in self._cache:
            return self._cache[key]
        if key in self._in_progress:
            # Circular reference — break the cycle defensively.
            return None

        formula = self._formulas.get(key)
        if formula is None:
            result = _coerce_literal(self._values.get(key))
            self._cache[key] = result
            return result

        self._in_progress.add(key)
        try:
            result = self._eval_formula(formula)
        except Exception:  # noqa: BLE001 - never let a bad formula crash extraction
            result = None
        finally:
            self._in_progress.discard(key)
        self._cache[key] = result
        return result

    # -- internals ---------------------------------------------------------

    def _eval_formula(self, formula: str) -> Decimal | None:
        expr = formula.lstrip("=").strip()
        if not expr:
            return None
        resolved = self._replace_functions(expr)
        if resolved is None:
            return None
        return self._eval_arith(resolved)

    def _replace_functions(self, expr: str) -> str | None:
        # Repeatedly resolve the innermost aggregate call to a literal number.
        guard = 0
        while True:
            match = _FUNC_RE.search(expr)
            if match is None:
                return expr
            guard += 1
            if guard > 200:
                return None
            func = match.group(1).upper()
            args = match.group(2)
            value = self._eval_func(func, args)
            if value is None:
                return None
            expr = expr[: match.start()] + _num_str(value) + expr[match.end() :]

    def _eval_func(self, func: str, args: str) -> Decimal | None:
        collected: list[Decimal] = []
        for raw_arg in args.split(","):
            arg = raw_arg.strip()
            if not arg:
                continue
            range_match = _RANGE_RE.fullmatch(arg)
            if range_match is not None:
                collected.extend(self._range_values(range_match))
                continue
            scalar = self._eval_arith(arg)
            if scalar is None:
                return None
            collected.append(scalar)

        if func == "COUNT":
            return Decimal(len(collected))
        if not collected:
            return Decimal(0)
        if func in {"AVERAGE", "AVG"}:
            return sum(collected, Decimal(0)) / Decimal(len(collected))
        if func == "MIN":
            return min(collected)
        if func == "MAX":
            return max(collected)
        # Default SUM.
        return sum(collected, Decimal(0))

    def _range_values(self, range_match: re.Match[str]) -> list[Decimal]:
        start_col = _col_to_index(range_match.group(1))
        start_row = int(range_match.group(2))
        end_col = _col_to_index(range_match.group(3))
        end_row = int(range_match.group(4))
        row_lo, row_hi = sorted((start_row, end_row))
        col_lo, col_hi = sorted((start_col, end_col))
        if (row_hi - row_lo + 1) * (col_hi - col_lo + 1) > _MAX_RANGE_CELLS:
            return []
        values: list[Decimal] = []
        for r in range(row_lo, row_hi + 1):
            for c in range(col_lo, col_hi + 1):
                resolved = self.evaluate(r, c)
                if resolved is not None:
                    values.append(resolved)
        return values

    def _eval_arith(self, expr: str) -> Decimal | None:
        substituted = self._substitute_refs(expr)
        if substituted is None:
            return None
        candidate = substituted.strip()
        if not candidate:
            return None
        if not _SAFE_EXPR_RE.fullmatch(candidate):
            # Leftover letters (unresolved ref / unknown token) → unsafe to eval.
            return None
        try:
            result = eval(candidate, {"__builtins__": {}}, {})  # noqa: S307 - sanitized arithmetic
        except (SyntaxError, ZeroDivisionError, ValueError, TypeError):
            return None
        if isinstance(result, bool):
            return None
        if isinstance(result, int | float):
            try:
                return Decimal(str(result))
            except InvalidOperation:
                return None
        return None

    def _substitute_refs(self, expr: str) -> str | None:
        def repl(match: re.Match[str]) -> str:
            column = _col_to_index(match.group(1))
            row = int(match.group(2))
            value = self.evaluate(row, column)
            return _num_str(value) if value is not None else "0"

        return _CELL_RE.sub(repl, expr)


def build_sheet_formula_evaluator(cells: dict[CellKey, JsonObject]) -> SheetFormulaEvaluator:
    """Construct an evaluator for a parsed sheet's ``(row, column) -> cell`` map."""
    return SheetFormulaEvaluator(cells)
