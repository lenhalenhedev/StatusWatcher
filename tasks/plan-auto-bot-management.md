# Implementation Plan: Event-driven Discord Bot Monitoring

## Overview

Chuyển việc quản lý bot uptime từ quét toàn bộ member ở mỗi monitoring cycle sang mô hình event-driven. Bot sẽ tự động thêm Discord bot khi nhận `guildMemberAdd`, tự động archive và loại khỏi runtime khi nhận `guildMemberRemove`, và khôi phục active bot từ SQLite khi khởi động. Lệnh `/add-bot` và `/remove-bot` sẽ bị loại bỏ; `/fetch-bot` là cơ chế reconciliation thủ công, fetch member theo batch tối đa 10 bot, nghỉ 10 giây giữa các batch và lưu kết quả vào SQLite rồi nạp vào RAM.

## Architecture Decisions

1. **SQLite là nguồn dữ liệu bền vững; `botStates` là runtime cache.** Startup đọc các target bot active từ SQLite, kiểm tra từng ID còn trong guild hay không, xóa target không còn tồn tại khỏi SQLite, và tạo runtime state cho target hợp lệ.
2. **Gateway events là đường cập nhật thường xuyên.** `guildMemberAdd` chỉ đăng ký member nếu member là bot; `guildMemberRemove` archive bot tương ứng. Monitoring cycle không gọi `guild.members.fetch()` nữa.
3. **`/fetch-bot` là reconciliation có kiểm soát.** Command fetch member theo batch 10, đếm lũy kế `fetched: N bot`, nghỉ 10 giây giữa các batch, dùng member cache/chunking API hiện có của Discord.js và cập nhật SQLite/RAM sau mỗi batch hoặc sau khi hoàn tất.
4. **Embed ưu tiên `hasImportantRole`.** Nếu `IMPORTANT_ROLE_ID` tồn tại trong member roles, bot được xếp trước các bot thường. Minecraft vẫn đứng trước bot ở page 1 khi `MC_ENABLE=true`. Mỗi page chứa tối đa 10 bot; bot quan trọng vượt quá phần còn lại của page 1 sẽ tự nhiên sang page 2 hoặc cao hơn.
5. **Không giữ lại đường quản trị cũ.** `/add-bot`, `/remove-bot`, parser input và menu remove chỉ bị xóa khi không còn call site; test cũ sẽ được thay bằng test event lifecycle, startup reconciliation, fetch batching và ordering.

## Task List

### Phase 1: Foundation
- [ ] Xác nhận schema `targets` đã lưu `type`, `has_important_role`, `status` và các helper archive/list hiện có.
- [ ] Tách helper tạo runtime state từ SQLite row và helper tạo state từ GuildMember.
- [ ] Viết RED tests cho startup restore, missing-guild archive, member add/remove và không full-fetch trong cycle.

### Phase 2: Fetch command
- [ ] Viết RED tests cho `/fetch-bot`: admin gate, batch size 10, cumulative progress, 10-second delay, persistence and RAM restore.
- [ ] Implement fetch service với clock/sleep injectable để test không phải chờ 10 giây thật.
- [ ] Register `/fetch-bot` and remove old commands from command registry.

### Phase 3: Embed and lifecycle integration
- [ ] Sort bot states by important role first while preserving deterministic tie-break order.
- [ ] Ensure Minecraft field remains first and bot pagination stays at 10 bots/page.
- [ ] Refresh status embed after member add/remove and after fetch completes.
- [ ] Remove full `guild.members.fetch()` from `checkBotStatuses()`.

### Checkpoint: Core behavior
- [ ] Focused tests pass for bot lifecycle, command registry, fetch batching and pagination.
- [ ] Syntax checks pass for all changed JavaScript.
- [ ] No call site invokes full member fetch during regular monitoring cycles.

### Phase 4: Polish and verification
- [ ] Remove orphaned manual command modules only after reference search confirms they are unreachable.
- [ ] Review correctness, readability, architecture, security and performance.
- [ ] Run full suite; record any pre-existing native dependency failures separately.
- [ ] Update `.env.example` with `IMPORTANT_ROLE_ID` semantics and operational notes for `/fetch-bot`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Presence cache is not complete after startup | Medium | Keep Gateway intents and restore state from SQLite; `/fetch-bot` is explicit reconciliation, not a cycle hot path. |
| Bot leaves before `guildMemberRemove` is received | High | Startup reconciliation archives missing IDs; `/fetch-bot` provides manual reconciliation. |
| Fetching hundreds/thousands of members overloads gateway/API | High | Batch at 10, wait 10 seconds, report cumulative progress, serialize concurrent fetch commands. |
| Archived bot re-joins guild | Medium | Decide event policy explicitly: re-register on join because membership proves it is a current monitorable bot. |
| Runtime state and SQLite diverge after partial fetch | Medium | Persist each accepted bot before/while adding it to RAM, and expose errors in command reply/logs. |
| Discord embed field/page limits | Medium | Keep max 10 bots/page and deterministic priority ordering; preserve existing field value limit handling. |

## Acceptance Criteria

- [ ] No `/add-bot` or `/remove-bot` command appears in command registry or deployed command payload.
- [ ] A bot joining the monitored guild is automatically active in uptime monitoring and appears in the embed after refresh.
- [ ] A bot leaving the monitored guild is removed from RAM, archived/removed from active SQLite records, and disappears from the embed.
- [ ] Startup restores active bot rows from SQLite, archives rows whose IDs are absent from the guild, and does not perform a full member fetch as part of the regular check cycle.
- [ ] `/fetch-bot` processes at most 10 bots per batch, waits 10 seconds between batches, reports cumulative `fetched: N bot`, persists all fetched bots to SQLite and loads them into RAM.
- [ ] Important-role bots are ordered before ordinary bots, Minecraft remains first when enabled, and the page size remains 10 bots.

## Open Questions / Assumptions

- `fetch-bot` is assumed to be admin-only, matching the removed manual management commands.
- “Remove from SQLite” is implemented as physical deletion, including dependent downtime sessions through the existing foreign-key cascade. This follows the explicit requirement; a bot that rejoins is treated as a new active target.
- A bot that leaves and later rejoins is assumed to be automatically reactivated because the new requirement says bots entering the guild should be added automatically.
