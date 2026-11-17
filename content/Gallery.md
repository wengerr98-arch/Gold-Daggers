---
title: "Gallery"
publish: true
---

Everyone the party has met who has a portrait so far.

```base
filters:
  and:
    - "!image.isEmpty()"
views:
  - type: cards
    name: Gallery
    order:
      - file.name
    image: note.image
    cardSize: 190
    imageAspectRatio: 1.3
```
