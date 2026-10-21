# OCR fixtures

Real 1920x1080 frames of Among Us v19s (build 7489) captured on 2026-10-21 on William's machine,
borderless fullscreen-windowed. They contain other players' public display names from a public lobby.
Used by `cargo test` (roster.rs, ocr.rs) so the OCR pipeline is regression-tested without the game.

| file | phase |
|---|---|
| menu.png | main menu |
| lobby.png | lobby, settings panel open (room code, map) |
| lobby_chat.png | lobby with chat open |
| role_card.png | round start, CREWMATE card |
| round_cafeteria.png / round_electrical.png / round_after_eject.png | round, task list top-left |
| meeting_banner.png | body-reported red banner |
| meeting_vote_grid.png / meeting_vote_grid_2.png | discussion, vote grid |
| meeting_chat.png / meeting_votes_cast.png | chat during meeting, 'X has voted' lines |
| voting_results.png | voting results |
| eject_text.png | ejection text mid-animation |
