#!/usr/bin/env python3
"""Conservative offline minifier for the thingino Web UI assets.

Removes HTML/JS comments, indentation, blank lines and trailing whitespace.
Every newline is kept so JavaScript ASI and HTML inline text stay intact, and
characters inside string/template literals, <pre> and <textarea> are never
touched. Third-party files under a/vendor/ are skipped (already minified).

Usage: python3 minify_www.py [--dry-run] <www_root>
"""

import argparse
import pathlib
import re
import sys

SKIP_DIRS = {'vendor'}
HTML_EXTENSIONS = {'.html', '.htm'}
BLOCK_RE = re.compile(
    r'(?P<open><(?P<tag>script|style|pre|textarea)\b[^>]*>)'
    r'(?P<body>.*?)(?P<close></(?P=tag)\s*>)',
    re.IGNORECASE | re.DOTALL,
)
HTML_COMMENT_RE = re.compile(r'<!--(?!\[if\b).*?-->', re.DOTALL)


def js_protection_mask(text: str) -> bytearray:
    """Mark characters that belong to a string, template literal or comment."""
    mask = bytearray(len(text))
    state = 'code'
    i = 0
    n = len(text)
    while i < n:
        char = text[i]
        following = text[i + 1] if i + 1 < n else ''
        if state == 'code':
            if char == '/' and following == '/':
                state = 'line'
                i += 2
                continue
            if char == '/' and following == '*':
                state = 'block'
                i += 2
                continue
            if char in "'\"`":
                state = char
                mask[i] = 1
                i += 1
                continue
            i += 1
            continue
        if state == 'line':
            if char == '\n':
                state = 'code'
            else:
                mask[i] = 1
            i += 1
            continue
        if state == 'block':
            if char == '*' and following == '/':
                mask[i] = mask[i + 1] = 1
                state = 'code'
                i += 2
                continue
            mask[i] = 1
            i += 1
            continue
        mask[i] = 1
        if char == '\\' and i + 1 < n:
            mask[i + 1] = 1
            i += 2
            continue
        if char == state:
            state = 'code'
        i += 1
    return mask


def compact(text: str, mask=None, drop_line_comments: bool = False) -> str:
    """Trim safe leading/trailing whitespace per line and drop blank lines."""
    result = []
    position = 0
    for raw in text.splitlines(keepends=True):
        body = raw.rstrip('\r\n')
        eol = raw[len(body):]
        line_mask = mask[position:position + len(raw)] if mask is not None else None
        position += len(raw)

        def protected(index):
            return line_mask is not None and line_mask[index] == 1

        start = 0
        while start < len(body) and body[start] in ' \t' and not protected(start):
            start += 1
        stop = len(body)
        while stop > start and body[stop - 1] in ' \t' and not protected(stop - 1):
            stop -= 1
        new_body = body[start:stop]

        if not new_body.strip():
            if all(not protected(i) for i in range(len(body))):
                continue
            result.append(body + eol)
            continue
        if drop_line_comments and new_body.startswith('//') and not protected(start):
            continue
        result.append(new_body + eol)
    return ''.join(result)


def compact_html_fragment(fragment: str) -> str:
    return compact(HTML_COMMENT_RE.sub('', fragment))


def minify_html(text: str) -> str:
    result = []
    last = 0
    for match in BLOCK_RE.finditer(text):
        result.append(compact_html_fragment(text[last:match.start()]))
        tag = match.group('tag').lower()
        body = match.group('body')
        if tag in ('pre', 'textarea'):
            new_body = body
        else:
            new_body = compact(body, js_protection_mask(body), tag == 'script')
        result.append(match.group('open') + new_body + match.group('close'))
        last = match.end()
    result.append(compact_html_fragment(text[last:]))
    return ''.join(result)


def minify_js(text: str) -> str:
    return compact(text, js_protection_mask(text), True)


def iter_assets(root: pathlib.Path):
    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_DIRS for part in relative.parts[:-1]):
            continue
        if path.name.endswith('.min.js'):
            continue
        if path.suffix.lower() in HTML_EXTENSIONS:
            yield path, minify_html
        elif path.suffix.lower() == '.js':
            yield path, minify_js


def main() -> int:
    parser = argparse.ArgumentParser(description='Minify HTML/JS files under a web root')
    parser.add_argument('root')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    root = pathlib.Path(args.root)
    if not root.is_dir():
        print(f'minify_www: not a directory: {root}', file=sys.stderr)
        return 1

    before = after = files = 0
    for path, minify in iter_assets(root):
        with open(path, 'r', encoding='utf-8', newline='') as handle:
            original = handle.read()
        updated = minify(original)
        original_size = len(original.encode('utf-8'))
        updated_size = len(updated.encode('utf-8'))
        before += original_size
        after += updated_size
        files += 1
        if updated != original and not args.dry_run:
            with open(path, 'w', encoding='utf-8', newline='') as handle:
                handle.write(updated)

    saved = before - after
    percent = (saved / before * 100) if before else 0
    print(f'minify_www: {"checked" if args.dry_run else "minified"} {files} file(s), '
          f'{before} -> {after} bytes (saved {saved} bytes, {percent:.1f}%)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
