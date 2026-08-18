# Kế hoạch triển khai `/config`

## Phạm vi

Xây dựng command Discord `/config` dành cho admin để quản trị cấu hình runtime trong SQLite, không dùng các biến môi trường cho các khóa cấu hình mà người dùng yêu cầu chỉnh từ Discord.

## Nguyên tắc thiết kế

1. `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `ADMIN_USER_ID`, `DB_PATH` và `HEALTH_PORT` vẫn là bootstrap/runtime infrastructure từ môi trường; không lưu token vào SQLite.
2. Các cấu hình nghiệp vụ gồm monitor/log channel, important role, monitoring timings, retry policy, digest cron và danh sách Minecraft server phải được lưu trong SQLite.
3. Cấu hình SQLite được nạp thành runtime snapshot có thể thay thế nguyên tử; mọi consumer đọc snapshot mới khi chạy.
4. `/config` phải được giới hạn cho `ADMIN_USER_ID`, xác thực dữ liệu ở boundary và dùng prepared statements.
5. Minecraft được bật khi có ít nhất một server active trong SQLite; xóa server sẽ ngừng monitor server đó và loại khỏi embed.
6. Config UI dùng custom-id namespace riêng, modal cho dữ liệu nhập và select menu cho xóa server.
7. Một trang hiển thị tối đa 23 nút cấu hình; khi có hơn 23 mục thì dành hàng đầu cho PREV/NEXT và edit cùng embed khi đổi trang.

## Slices

### Slice 1: Config schema/store

- Thêm bảng `runtime_config` dạng key/value hoặc schema tương đương.
- Thêm bảng `minecraft_servers` với id, name, host, port, active, timestamps.
- Cung cấp get/set/list/delete transaction-safe.
- Seed giá trị từ environment chỉ cho migration lần đầu, không ghi đè giá trị SQLite ở mỗi startup.

### Slice 2: Runtime config manager

- Expose snapshot immutable và `reloadRuntimeConfig()`.
- Parse/validate integer, cron, Discord snowflake, `domain:port`, backoff list.
- Cung cấp getters cho consumers.
- Cho phép cập nhật interval/check schedule và MC monitor sau khi config thay đổi.

### Slice 3: RED/GREEN config interactions

- `/config` admin gate.
- Embed mô tả chức năng và giá trị hiện tại.
- Button mở modal cho từng cấu hình scalar.
- Add MC modal: server name + `host:port`.
- Remove MC select menu: chọn server hiện có và xóa.
- Modal submit lưu SQLite, reload snapshot, apply runtime và update embed.

### Slice 4: Pagination

- Tối đa 23 config buttons/page.
- Nếu vượt 23: hàng đầu là PREV/NEXT, các config buttons nằm sau; page switch dùng `interaction.update`.
- Không tạo component vượt giới hạn Discord.

### Slice 5: Consumer migration

- `embedBuilder`, `notifier`, `digest`, target utils và command admin đọc runtime snapshot.
- MC monitor chuyển sang nhiều server, mỗi server có state riêng và target id ổn định.
- Check interval/cron/retry/backoff lấy từ snapshot.
- Config update channel/role áp dụng ngay cho status embed và notifier.

## Acceptance criteria

- `/config` khi admin gọi hiển thị embed với mô tả, giá trị hiện tại và các nút.
- Non-admin không thể mở hoặc submit config.
- Add MC nhận `name` và `host:port` hợp lệ, ghi SQLite, xuất hiện trong uptime embed ngay.
- Remove MC dùng dropdown, xóa target/server khỏi SQLite, RAM và embed ngay.
- Important role/channel và mọi numeric/cron config được lưu SQLite và có hiệu lực cho lần gọi tiếp theo mà không restart.
- Restart không làm mất config SQLite; environment chỉ làm seed fallback khi key chưa tồn tại.
- Trên 23 mục có PREV/NEXT; dưới hoặc bằng 23 mục không có hai nút này.
- Input sai bị từ chối với lỗi dễ hiểu, không crash process.
- Test focused pass; full suite được chạy và giới hạn native dependency được ghi nhận nếu tái diễn.
