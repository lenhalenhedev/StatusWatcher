# Checklist `/config`

## Khảo sát và thiết kế

- [ ] Xác định các environment key được chuyển vào SQLite.
- [ ] Giữ bootstrap secrets và hạ tầng ngoài phạm vi `/config`.
- [ ] Chốt schema runtime config và minecraft servers.
- [ ] Chốt custom-id namespace, modal field ids và pagination state.

## Persistence và runtime

- [ ] Tạo bảng config key/value bằng migration idempotent.
- [ ] Tạo bảng minecraft servers và index cần thiết.
- [ ] Seed environment chỉ khi SQLite chưa có key.
- [ ] Validate input trước khi gọi store.
- [ ] Reload snapshot nguyên tử sau mỗi thay đổi.
- [ ] Apply ngay monitoring interval, cron, channels, role, MC targets và retry policy.

## Discord UI

- [ ] Đăng ký `/config`.
- [ ] Admin authorization ở execute và component submit.
- [ ] Embed có mô tả và giá trị hiện tại.
- [ ] Modal Add MC với name và host:port.
- [ ] Select Remove MC với danh sách hiện tại.
- [ ] Modal cho Important Role, Monitor Channel, Log Channel.
- [ ] Modal cho toàn bộ numeric/backoff/cron config.
- [ ] Pagination 23 config buttons/page, PREV/NEXT khi cần.
- [ ] Hủy/đóng modal và lỗi validation không làm mất interaction.

## Kiểm thử

- [ ] RED tests cho parsing và validation.
- [ ] RED tests cho SQLite round-trip và seed không ghi đè.
- [ ] RED tests cho add/remove Minecraft.
- [ ] RED tests cho admin gate và modal/select routing.
- [ ] RED tests cho pagination <=23 và >23.
- [ ] GREEN focused tests sau từng slice.
- [ ] Syntax check và `git diff --check`.
- [ ] Full test suite; ghi rõ lỗi native baseline nếu còn.

## Bàn giao

- [ ] Cập nhật `.env.example` loại bỏ các key đã chuyển sang `/config` hoặc ghi chú migration.
- [ ] Cập nhật README hướng dẫn bootstrap và `/config`.
- [ ] Đóng gói source không gồm node_modules, `.git` và data runtime.
- [ ] Ghi hướng dẫn deploy commands và restart/migration.
