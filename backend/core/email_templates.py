"""One layout, one voice, for every email the system sends.

Each outgoing message is described as an :class:`EmailBody` - who it is for, what
happened, the reference numbers that identify the transaction, the products it
covers, the reason behind the action, and the next step - and this module renders
that description into an HTML part and a matching plain-text part.

Two rules shape the markup. Email clients only support a narrow, dated subset of
CSS, so the layout is nested tables with inline styles and a single small media
query for phones. Spam filters read tone as well as content, so the copy helpers
here avoid shouting capitals, exclamation marks, emoji, and promotional phrasing,
and every message carries a plain-text alternative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import escape
from typing import Iterable, Sequence

from django.utils import timezone

COMPANY_NAME = "Ann Ann's Beverages Trading"
COMPANY_SHORT_NAME = "AAB Trading"
AUTOMATED_NOTICE = "This is an automated message. Please do not reply to this email."

# One navy for structure, one green for the brand rule, grey text on white. Flat
# colours only: gradients render inconsistently across email clients.
INK = "#22272F"
MUTED = "#5A6472"
NAVY = "#0B3B82"
GREEN = "#2F8F3E"
LINE = "#E1E6ED"
CANVAS = "#F2F4F7"
PANEL = "#F7F9FC"


@dataclass
class ProductLine:
    """One row of the ordered-product table."""

    name: str
    category: str = ""
    size: str = ""
    quantity: str = ""


@dataclass
class EmailBody:
    """Everything a message says, independent of how it is rendered."""

    recipient_name: str = ""
    # "Good morning" / "Good afternoon" / "Good evening"; omitted when not useful.
    time_greeting: str = ""
    # The sentences that explain what happened, in the order they should be read.
    paragraphs: Sequence[str] = field(default_factory=list)
    # Reference information: ("Purchase Request No.", "PR-0001").
    details: Sequence[tuple[str, str]] = field(default_factory=list)
    details_heading: str = "Reference details"
    products: Sequence[ProductLine] = field(default_factory=list)
    products_heading: str = "Products included in this request"
    reason_label: str = ""
    reason_text: str = ""
    # A one-time code panel, for the authentication messages only.
    code: str = ""
    code_label: str = "Verification code"
    code_note: str = ""
    next_step: str = ""
    closing: str = "Thank you."
    # A short line shown under the closing, e.g. security advice on an OTP mail.
    note: str = ""


def time_greeting() -> str:
    """Return a greeting that matches the recipient's local time of day."""
    hour = timezone.localtime(timezone.now()).hour
    if hour < 12:
        return "Good morning"
    if hour < 18:
        return "Good afternoon"
    return "Good evening"


def format_quantity(quantity: int | float | None, unit: str = "") -> str:
    """Render a quantity the way a person would write it: "10 Cases"."""
    try:
        amount = int(quantity or 0)
    except (TypeError, ValueError):
        amount = 0
    label = str(unit or "").strip()
    if not label:
        return str(amount)
    label = label.replace("_", " ").strip().title()
    if amount != 1 and not label.endswith("s"):
        label = f"{label}s"
    return f"{amount} {label}"


def _clean(value: object) -> str:
    return str(value if value is not None else "").strip()


def _paragraph_html(text: str) -> str:
    return (
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:{INK};">'
        f'{escape(text).replace(chr(10), "<br>")}</p>'
    )


def _details_html(body: EmailBody) -> str:
    rows = [(label, value) for label, value in body.details if _clean(value)]
    if not rows:
        return ""
    cells = "".join(
        f'<tr>'
        f'<td style="padding:6px 12px 6px 0;font-size:14px;line-height:1.5;color:{MUTED};'
        f'white-space:nowrap;vertical-align:top;">{escape(label)}</td>'
        f'<td style="padding:6px 0;font-size:14px;line-height:1.5;color:{INK};font-weight:bold;'
        f'vertical-align:top;">{escape(_clean(value))}</td>'
        f'</tr>'
        for label, value in rows
    )
    return (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="border-collapse:collapse;margin:0 0 22px;background:{PANEL};border:1px solid {LINE};'
        f'border-radius:6px;">'
        f'<tr><td class="pad" style="padding:16px 18px;">'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="border-collapse:collapse;">{cells}</table>'
        f'</td></tr></table>'
    )


def _products_html(body: EmailBody) -> str:
    if not body.products:
        return ""
    show_category = any(_clean(line.category) for line in body.products)
    show_size = any(_clean(line.size) for line in body.products)

    headers = ["Product"]
    if show_category:
        headers.append("Category")
    if show_size:
        headers.append("Size")
    headers.append("Quantity")

    head_cells = "".join(
        f'<th align="{"right" if header == "Quantity" else "left"}" class="cell" '
        f'style="padding:10px 12px;font-size:12px;line-height:1.4;letter-spacing:0.04em;'
        f'text-transform:uppercase;color:{MUTED};font-weight:bold;border-bottom:1px solid {LINE};'
        f'background:{PANEL};">{escape(header)}</th>'
        for header in headers
    )

    body_rows = []
    for line in body.products:
        cells = [
            f'<td class="cell" style="padding:12px;font-size:14px;line-height:1.5;color:{INK};'
            f'border-bottom:1px solid {LINE};">{escape(_clean(line.name) or "Product")}</td>'
        ]
        if show_category:
            cells.append(
                f'<td class="cell" style="padding:12px;font-size:14px;line-height:1.5;color:{MUTED};'
                f'border-bottom:1px solid {LINE};">{escape(_clean(line.category) or "-")}</td>'
            )
        if show_size:
            cells.append(
                f'<td class="cell" style="padding:12px;font-size:14px;line-height:1.5;color:{MUTED};'
                f'border-bottom:1px solid {LINE};">{escape(_clean(line.size) or "-")}</td>'
            )
        cells.append(
            f'<td class="cell" align="right" style="padding:12px;font-size:14px;line-height:1.5;'
            f'color:{INK};font-weight:bold;white-space:nowrap;border-bottom:1px solid {LINE};">'
            f'{escape(_clean(line.quantity) or "-")}</td>'
        )
        body_rows.append(f'<tr>{"".join(cells)}</tr>')

    heading = _clean(body.products_heading)
    heading_html = (
        f'<p style="margin:0 0 8px;font-size:13px;line-height:1.5;font-weight:bold;color:{INK};">'
        f'{escape(heading)}</p>'
        if heading else ""
    )
    return (
        f'{heading_html}'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="border-collapse:collapse;margin:0 0 22px;border:1px solid {LINE};border-radius:6px;">'
        f'<tr>{head_cells}</tr>{"".join(body_rows)}</table>'
    )


def _reason_html(body: EmailBody) -> str:
    if not _clean(body.reason_text):
        return ""
    label = _clean(body.reason_label) or "Reason"
    return (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="border-collapse:collapse;margin:0 0 22px;border-left:3px solid {NAVY};background:{PANEL};">'
        f'<tr><td class="pad" style="padding:14px 18px;">'
        f'<p style="margin:0 0 4px;font-size:13px;line-height:1.5;font-weight:bold;color:{INK};">'
        f'{escape(label)}</p>'
        f'<p style="margin:0;font-size:14px;line-height:1.6;color:{INK};">'
        f'{escape(_clean(body.reason_text)).replace(chr(10), "<br>")}</p>'
        f'</td></tr></table>'
    )


def _code_html(body: EmailBody) -> str:
    if not _clean(body.code):
        return ""
    spaced = "&nbsp;".join(escape(char) for char in _clean(body.code))
    note = (
        f'<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:{MUTED};">'
        f'{escape(_clean(body.code_note))}</p>'
        if _clean(body.code_note) else ""
    )
    return (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
        f'style="border-collapse:collapse;margin:0 0 22px;border:1px solid {LINE};border-radius:6px;'
        f'background:{PANEL};">'
        f'<tr><td class="pad" align="center" style="padding:22px 18px;">'
        f'<p style="margin:0 0 10px;font-size:12px;line-height:1.4;letter-spacing:0.04em;'
        f'text-transform:uppercase;color:{MUTED};font-weight:bold;">{escape(_clean(body.code_label))}</p>'
        f'<p style="margin:0;font-size:30px;line-height:1.2;letter-spacing:0.18em;font-weight:bold;'
        f'color:{NAVY};">{spaced}</p>{note}'
        f'</td></tr></table>'
    )


def _greeting_html(body: EmailBody) -> str:
    name = _clean(body.recipient_name)
    salutation = f"Hi {name}," if name else "Hello,"
    parts = [
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:{INK};">'
        f'{escape(salutation)}</p>'
    ]
    if _clean(body.time_greeting):
        parts.append(_paragraph_html(f"{_clean(body.time_greeting)}."))
    return "".join(parts)


def render_html(body: EmailBody, *, heading: str, preheader: str = "", logo_src: str = "") -> str:
    """Render the message as an email-client-safe HTML document."""
    year = timezone.localtime(timezone.now()).year
    logo = (
        f'<img src="{escape(logo_src)}" alt="{escape(COMPANY_SHORT_NAME)}" width="132" '
        f'style="display:block;width:132px;max-width:132px;height:auto;border:0;">'
        if logo_src else
        f'<p style="margin:0;font-size:18px;line-height:1.3;font-weight:bold;color:{NAVY};">'
        f'{escape(COMPANY_NAME)}</p>'
    )
    hidden_preheader = (
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;'
        f'height:0;width:0;">{escape(preheader)}</div>'
        if _clean(preheader) else ""
    )
    next_step_html = _paragraph_html(_clean(body.next_step)) if _clean(body.next_step) else ""
    closing_html = _paragraph_html(_clean(body.closing)) if _clean(body.closing) else ""
    note_html = (
        f'<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:{MUTED};">'
        f'{escape(_clean(body.note))}</p>'
        if _clean(body.note) else ""
    )
    paragraphs_html = "".join(_paragraph_html(text) for text in body.paragraphs if _clean(text))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(heading)}</title>
<style>
  @media only screen and (max-width:600px) {{
    .wrap {{ width:100% !important; }}
    .pad {{ padding-left:18px !important; padding-right:18px !important; }}
    .cell {{ padding-left:8px !important; padding-right:8px !important; font-size:13px !important; }}
    .h1 {{ font-size:19px !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:{CANVAS};">
{hidden_preheader}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{CANVAS};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellspacing="0" cellpadding="0" border="0"
 style="width:600px;max-width:600px;background:#FFFFFF;border:1px solid {LINE};border-radius:8px;
 font-family:Arial,Helvetica,sans-serif;">
  <tr><td class="pad" style="padding:24px 32px 18px;border-bottom:1px solid {LINE};">{logo}</td></tr>
  <tr><td style="height:3px;background:{GREEN};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td class="pad" style="padding:28px 32px 8px;">
    <h1 class="h1" style="margin:0 0 18px;font-size:21px;line-height:1.35;font-weight:bold;color:{NAVY};">
      {escape(heading)}</h1>
    {_greeting_html(body)}
    {paragraphs_html}
    {_code_html(body)}
    {_details_html(body)}
    {_products_html(body)}
    {_reason_html(body)}
    {next_step_html}
    {closing_html}
    {note_html}
  </td></tr>
  <tr><td class="pad" style="padding:22px 32px 26px;">
    <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:{INK};font-weight:bold;">
      {escape(COMPANY_NAME)}</p>
    <p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:{MUTED};">
      {escape(AUTOMATED_NOTICE)}</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:{MUTED};">
      &copy; {year} {escape(COMPANY_NAME)}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def _text_table(products: Sequence[ProductLine]) -> list[str]:
    show_category = any(_clean(line.category) for line in products)
    show_size = any(_clean(line.size) for line in products)

    headers = ["Product"]
    if show_category:
        headers.append("Category")
    if show_size:
        headers.append("Size")
    headers.append("Quantity")

    rows: list[list[str]] = []
    for line in products:
        row = [_clean(line.name) or "Product"]
        if show_category:
            row.append(_clean(line.category) or "-")
        if show_size:
            row.append(_clean(line.size) or "-")
        row.append(_clean(line.quantity) or "-")
        rows.append(row)

    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(value))

    def _line(values: Iterable[str]) -> str:
        return "  ".join(value.ljust(widths[index]) for index, value in enumerate(values)).rstrip()

    out = [_line(headers), "  ".join("-" * width for width in widths)]
    out.extend(_line(row) for row in rows)
    return out


def render_text(body: EmailBody, *, heading: str) -> str:
    """Render the plain-text alternative that mirrors the HTML part."""
    name = _clean(body.recipient_name)
    lines: list[str] = [heading, "", f"Hi {name}," if name else "Hello,"]
    if _clean(body.time_greeting):
        lines += ["", f"{_clean(body.time_greeting)}."]
    for text in body.paragraphs:
        if _clean(text):
            lines += ["", _clean(text)]

    if _clean(body.code):
        lines += ["", f"{_clean(body.code_label)}: {_clean(body.code)}"]
        if _clean(body.code_note):
            lines.append(_clean(body.code_note))

    detail_rows = [(label, _clean(value)) for label, value in body.details if _clean(value)]
    if detail_rows:
        lines += ["", f"{_clean(body.details_heading)}:"]
        width = max(len(label) for label, _ in detail_rows)
        lines += [f"  {label.ljust(width)}  {value}" for label, value in detail_rows]

    if body.products:
        # Some headings already end in a colon ("Below are the details of your request:").
        lines += ["", f"{_clean(body.products_heading).rstrip(':')}:"]
        lines += [f"  {row}" for row in _text_table(body.products)]

    if _clean(body.reason_text):
        lines += ["", f"{_clean(body.reason_label) or 'Reason'}:", _clean(body.reason_text)]

    if _clean(body.next_step):
        lines += ["", _clean(body.next_step)]
    if _clean(body.closing):
        lines += ["", _clean(body.closing)]
    if _clean(body.note):
        lines += ["", _clean(body.note)]

    lines += ["", "--", COMPANY_NAME, AUTOMATED_NOTICE]
    return "\n".join(lines).strip() + "\n"
