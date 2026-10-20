# Caption stays grey on dark slides

The theme's `.caption` colour is `#666` whatever the slide background, so a caption on a `.dark` slide is close to unreadable. Found on 20 October 2026 in the EES 2026 Mosquitoes deck (`EES2026-bites-slides.md`, the "Our claim" slide), where it was worked around by making that one caption white by hand.

- Give `.caption` a light colour inside `.dark` (and any other dark slide classes) in the theme CSS, rather than leaving each deck to patch it.
- Then remove the hand-set white from that deck's "Our claim" caption.
