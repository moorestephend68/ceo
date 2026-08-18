"""Inline the economy engine into the live client.

public/live.html is BUILT, not written. The multiplayer page needs the engine in
it for one reason: the projection panel has to be computed with the same code the
server will use to resolve the round. An approximation would be worse than
nothing — the practice levels promise an exact projection, and a player moving
from those to a live game should not find the number quietly became a guess.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) or '.')


def strip_node_blocks(src):
    out, i = [], 0
    needle = "if (typeof module !== 'undefined') {"
    while True:
        j = src.find(needle, i)
        if j == -1:
            out.append(src[i:])
            break
        out.append(src[i:j])
        depth, k = 0, j + len(needle) - 1
        while k < len(src):
            if src[k] == '{':
                depth += 1
            elif src[k] == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        i = k + 1
    return ''.join(out)


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    eng = strip_node_blocks(open(os.path.join(root, '..', 'engine.js')).read())
    assert 'module.exports' not in eng, 'an export block survived'
    tpl = open(os.path.join(root, 'src', 'live-template.html')).read()
    assert '/*__ENGINE__*/' in tpl, 'no engine placeholder in the template'
    html = tpl.replace('/*__ENGINE__*/', eng)

    # The page says which build it is, so "did my change reach the site?" is a
    # thing anyone can read off the screen instead of deducing from file hashes.
    version = open(os.path.join(root, 'lib', 'version.mjs')).read()
    build = version.split("BUILD = '")[1].split("'")[0]
    assert '/*__BUILD__*/' in html, 'no build placeholder in the template'
    html = html.replace('/*__BUILD__*/', build)
    for sym in ['function resolve', 'function sharedDemands', 'function estimateShare',
                'function unitCost', 'function creditRate', 'const KINDS',
                'function effCapacity', 'function newProduct']:
        assert sym in html, f'{sym} missing from the bundle'
    out = os.path.join(root, 'public', 'live.html')
    open(out, 'w').write(html)
    print(f'built public/live.html ({len(html):,} bytes)')


if __name__ == '__main__':
    main()
