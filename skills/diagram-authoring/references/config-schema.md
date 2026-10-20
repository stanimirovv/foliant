# Foliant %% CONFIG: Schema Reference

The `%% CONFIG: ` line in a Foliant Mermaid diagram is a JSON-serialized configuration line enabling deep diagram customization, domain filtering, and saved views.

## Full JSON Schema

```json
{
  "version": 1,
  "defaultArrowStyle": {
    "color": "#00ff9d",
    "width": 2
  },
  "actors": {
    "ActorId": {
      "color": "#213b5e",
      "keys": ["tag1", "tag2"]
    }
  },
  "arrows": [
    {
      "from": "SenderId",
      "to": "ReceiverId",
      "label": "Message Text",
      "occurrence": 0,
      "color": "#00ff9d",
      "width": 2,
      "dash": "solid",
      "animation": "flow",
      "keys": ["tag1"],
      "keyMode": "merged"
    }
  ],
  "noteTags": [
    {
      "over": ["Actor1", "Actor2"],
      "text": "Note text content",
      "occurrence": 0,
      "keys": ["tag1"]
    }
  ],
  "notes": [
    {
      "id": "note_123456789_abcde",
      "x": 100,
      "y": 150,
      "text": "Floating sticky note",
      "color": "yellow",
      "keys": ["review"]
    }
  ],
  "views": [
    {
      "name": "Happy Path",
      "hiddenPaths": ["flow=checkout/edge-case=card-declined"]
    }
  ]
}
```
