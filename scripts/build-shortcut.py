#!/usr/bin/env python3
"""Generates the "Open in Apple Music" Shortcut as an unsigned .shortcut plist.

Sign it before importing:
    shortcuts sign -m anyone -i shortcut/OpenInAppleMusic.unsigned.shortcut \
                             -o shortcut/OpenInAppleMusic.shortcut
"""
import plistlib
import uuid
from pathlib import Path

OG_TITLE_RE = r'<meta property="og:title" content="([^"]*)"'
OG_DESC_RE = r'<meta property="og:description" content="([^"]*)"'
SEPARATOR = " · "          # space, middle dot, space
PLACEHOLDER = "￼"          # object replacement char marks a variable slot
STOREFRONT = "ch"


def uid():
    return str(uuid.uuid4()).upper()


# One UUID per action output we need to reference later.
U = {k: uid() for k in
     ("link", "html", "m_title", "title", "m_desc", "desc",
      "parts", "artist", "term", "enc", "api", "json",
      "results", "first", "track")}


def output(key, name):
    """A magic variable referring to an earlier action's output."""
    return {
        "Value": {"OutputName": name, "OutputUUID": U[key], "Type": "ActionOutput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def text(parts):
    """Builds a text token string. `parts` mixes literals and (key, name) tuples."""
    string, attachments = "", {}
    for part in parts:
        if isinstance(part, str):
            string += part
        else:
            key, name = part
            # Offsets are UTF-16 code units; everything here is BMP so len() matches.
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


actions = [
    # 1. Pull the URL out of whatever the share sheet handed us.
    action("detect.link",
           UUID=U["link"],
           WFInput={"Value": {"Type": "ExtensionInput"},
                    "WFSerializationType": "WFTextTokenAttachment"}),

    # 2. Fetch the Spotify page. Follows redirects, so spotify.link resolves here.
    action("downloadurl",
           UUID=U["html"],
           WFHTTPMethod="GET",
           WFURL=output("link", "URLs")),

    # 3-4. og:title -> the track name.
    action("text.match",
           UUID=U["m_title"],
           WFMatchTextPattern=OG_TITLE_RE,
           text=output("html", "Contents of URL")),
    action("text.match.getgroup",
           UUID=U["title"],
           WFGroupIndex=1,
           WFGetGroupType="Group At Index",
           WFInput=output("m_title", "Matches")),

    # 5-6. og:description -> "Artist · Title · Song · Year".
    action("text.match",
           UUID=U["m_desc"],
           WFMatchTextPattern=OG_DESC_RE,
           text=output("html", "Contents of URL")),
    action("text.match.getgroup",
           UUID=U["desc"],
           WFGroupIndex=1,
           WFGetGroupType="Group At Index",
           WFInput=output("m_desc", "Matches")),

    # 7-8. First segment of the description is the artist.
    action("text.split",
           UUID=U["parts"],
           WFTextSeparator="Custom",
           WFTextCustomSeparator=SEPARATOR,
           text=output("desc", "Matched Text")),
    action("getitemfromlist",
           UUID=U["artist"],
           WFItemSpecifier="First Item",
           WFInput=output("parts", "Split Text")),

    # 9-10. Build "<artist> <title>" and percent-encode it in one go, which
    # avoids per-token URL-encode aggrandizements.
    action("gettext",
           UUID=U["term"],
           WFTextActionText=text([(("artist"), "Item from List"), " ", ("title", "Matched Text")])),
    action("urlencode",
           UUID=U["enc"],
           WFEncodeMode="Encode",
           WFInput=output("term", "Text")),

    # 11-12. Query Apple's public catalogue on the CH storefront.
    action("gettext",
           UUID=U["api"],
           WFTextActionText=text([
               "https://itunes.apple.com/search?term=",
               ("enc", "URL Encoded Text"),
               f"&media=music&entity=song&country={STOREFRONT.upper()}&limit=1",
           ])),
    action("downloadurl",
           UUID=U["json"],
           WFHTTPMethod="GET",
           WFURL=output("api", "Text")),

    # 13-15. results[0].trackViewUrl
    action("getvalueforkey",
           UUID=U["results"],
           WFDictionaryKey="results",
           WFInput=output("json", "Contents of URL")),
    action("getitemfromlist",
           UUID=U["first"],
           WFItemSpecifier="First Item",
           WFInput=output("results", "Dictionary Value")),
    action("getvalueforkey",
           UUID=U["track"],
           WFDictionaryKey="trackViewUrl",
           WFInput=output("first", "Item from List")),

    # 16. Apple Music claims music.apple.com links, so this opens the app.
    action("openurl",
           UUID=uid(),
           WFInput=output("track", "Dictionary Value")),
]

workflow = {
    "WFWorkflowActions": actions,
    "WFWorkflowClientVersion": "1200.2",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowIcon": {
        "WFWorkflowIconStartColor": 4292093695,
        "WFWorkflowIconGlyphNumber": 59511,
    },
    "WFWorkflowImportQuestions": [],
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": [
        "WFURLContentItem",
        "WFStringContentItem",
    ],
    "WFQuickActionSurfaces": [],
}

out = Path("shortcut/OpenInAppleMusic.unsigned.shortcut")
out.write_bytes(plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY))
print(f"wrote {out} ({out.stat().st_size} bytes, {len(actions)} actions)")
