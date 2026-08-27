#!/usr/bin/env python3
"""Generates the Apple Music Shortcuts as unsigned .shortcut plists.

Two variants, because WhatsApp offers Copy but not Share on a message:

  OpenInAppleMusic         - share sheet input (Messages, Safari, Spotify, ...)
  AppleMusicFromClipboard  - clipboard input (WhatsApp, Instagram, anywhere)

Sign before importing:
    shortcuts sign -m anyone -i <name>.unsigned.shortcut -o <name>.shortcut
"""
import plistlib
import uuid
from pathlib import Path

OG_TITLE_RE = r'<meta property="og:title" content="([^"]*)"'
OG_DESC_RE = r'<meta property="og:description" content="([^"]*)"'
SEPARATOR = " · "          # space, middle dot, space
PLACEHOLDER = "￼"          # object replacement char marks a variable slot
STOREFRONT = "CH"

VARIANTS = {
    "OpenInAppleMusic": ("share", ["ActionExtension"]),
    "AppleMusicFromClipboard": ("clipboard", []),
}


def uid():
    return str(uuid.uuid4()).upper()


def build(source):
    """Builds one variant's action list. UUIDs are minted per call, so the
    two variants never share identifiers."""
    U = {k: uid() for k in
         ("clip", "link", "html", "m_title", "title", "m_desc", "desc",
          "parts", "artist", "term", "enc", "api", "json",
          "results", "first", "track")}

    def output(key, name):
        """A magic variable referring to an earlier action's output."""
        return {
            "Value": {"OutputName": name, "OutputUUID": U[key], "Type": "ActionOutput"},
            "WFSerializationType": "WFTextTokenAttachment",
        }

    def text(parts):
        """Text token string. `parts` mixes literals and (key, name) tuples."""
        string, attachments = "", {}
        for part in parts:
            if isinstance(part, str):
                string += part
            else:
                key, name = part
                # Offsets are UTF-16 code units; all BMP here, so len() matches.
                attachments[f"{{{len(string)}, 1}}"] = {
                    "OutputName": name, "OutputUUID": U[key], "Type": "ActionOutput"
                }
                string += PLACEHOLDER
        return {
            "Value": {"string": string, "attachmentsByRange": attachments},
            "WFSerializationType": "WFTextTokenString",
        }

    def action(identifier, **params):
        return {
            "WFWorkflowActionIdentifier": f"is.workflow.actions.{identifier}",
            "WFWorkflowActionParameters": params,
        }

    if source == "share":
        head = [action("detect.link",
                       UUID=U["link"],
                       WFInput={"Value": {"Type": "ExtensionInput"},
                                "WFSerializationType": "WFTextTokenAttachment"})]
    else:
        head = [
            action("getclipboard", UUID=U["clip"]),
            action("detect.link", UUID=U["link"], WFInput=output("clip", "Clipboard")),
        ]

    return head + [
        # Fetch the Spotify page. Follows redirects, so spotify.link resolves here.
        action("downloadurl",
               UUID=U["html"], WFHTTPMethod="GET", WFURL=output("link", "URLs")),

        # og:title -> the track name.
        action("text.match",
               UUID=U["m_title"], WFMatchTextPattern=OG_TITLE_RE,
               text=output("html", "Contents of URL")),
        action("text.match.getgroup",
               UUID=U["title"], WFGroupIndex=1, WFGetGroupType="Group At Index",
               WFInput=output("m_title", "Matches")),

        # og:description -> "Artist · Title · Song · Year".
        action("text.match",
               UUID=U["m_desc"], WFMatchTextPattern=OG_DESC_RE,
               text=output("html", "Contents of URL")),
        action("text.match.getgroup",
               UUID=U["desc"], WFGroupIndex=1, WFGetGroupType="Group At Index",
               WFInput=output("m_desc", "Matches")),

        # First segment of the description is the artist.
        action("text.split",
               UUID=U["parts"], WFTextSeparator="Custom",
               WFTextCustomSeparator=SEPARATOR, text=output("desc", "Matched Text")),
        action("getitemfromlist",
               UUID=U["artist"], WFItemSpecifier="First Item",
               WFInput=output("parts", "Split Text")),

        # Build "<artist> <title>" and percent-encode it in one go, which avoids
        # per-token URL-encode aggrandizements.
        action("gettext",
               UUID=U["term"],
               WFTextActionText=text([("artist", "Item from List"), " ",
                                      ("title", "Matched Text")])),
        action("urlencode",
               UUID=U["enc"], WFEncodeMode="Encode", WFInput=output("term", "Text")),

        # Query Apple's public catalogue on the CH storefront.
        action("gettext",
               UUID=U["api"],
               WFTextActionText=text([
                   "https://itunes.apple.com/search?term=",
                   ("enc", "URL Encoded Text"),
                   f"&media=music&entity=song&country={STOREFRONT}&limit=1",
               ])),
        action("downloadurl",
               UUID=U["json"], WFHTTPMethod="GET", WFURL=output("api", "Text")),

        # results[0].trackViewUrl
        action("getvalueforkey",
               UUID=U["results"], WFDictionaryKey="results",
               WFInput=output("json", "Contents of URL")),
        action("getitemfromlist",
               UUID=U["first"], WFItemSpecifier="First Item",
               WFInput=output("results", "Dictionary Value")),
        action("getvalueforkey",
               UUID=U["track"], WFDictionaryKey="trackViewUrl",
               WFInput=output("first", "Item from List")),

        # Apple Music claims music.apple.com links, so this opens the app.
        action("openurl", UUID=uid(), WFInput=output("track", "Dictionary Value")),
    ]


for name, (source, types) in VARIANTS.items():
    workflow = {
        "WFWorkflowActions": build(source),
        "WFWorkflowClientVersion": "1200.2",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowHasShortcutInputVariables": source == "share",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4292093695,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": types,
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem"],
        "WFQuickActionSurfaces": [],
    }
    out = Path(f"shortcut/{name}.unsigned.shortcut")
    out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
    print(f"wrote {out} ({len(workflow['WFWorkflowActions'])} actions)")
