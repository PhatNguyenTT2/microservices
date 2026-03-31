# Tài liệu Kiến trúc & Luồng hoạt động (Workflow) - Service 1 (Auth & Customer)

Tài liệu này mô tả chi tiết về mặt kiến trúc và các luồng xử lý cốt lõi của **Service 1 (Authentication & Customer Management)** theo chuẩn thiết kế Agentic Microservices.

---

## 1. Kiến trúc Tổng quan (Layered Architecture)

Service 1 áp dụng cấu trúc phân tầng (4 layers) nhằm đảm bảo **Separation of Concerns (SoC)**, giúp code dễ bảo trì, mở rộng và test độc lập.

`Client Request` ➡️ **Route Layer** ➡️ **Service Layer** ➡️ **Repository Layer** ➡️ **Database Layer (PostgreSQL)**

1. **Route (Tầng Giao tiếp HTTP):**
   - Đón nhận HTTP Request.
   - Chạy qua các middleware bảo mật (Rate Limiting chống brute-force, Verify JWT Token).
   - Gọi Service tương ứng.
   - Format HTTP Response trả về cho client theo chuẩn chung (`success()`, `paginated()`) hoặc đẩy lỗi vào Error Handler tập trung.

2. **Service (Tầng Logic Nghiệp vụ):**
   - Chứa toàn bộ "Business Rules" (Ví dụ: Băm hash mật khẩu, cấp JWT token, kiểm tra username/email trùng, phối hợp nhiều Repository lại với nhau).
   - *Nguyên tắc:* Tầng này hoàn toàn không chứa câu lệnh SQL hay biết DB bên dưới là gì.

3. **Repository (Tầng Truy cập Dữ liệu):**
   - Chịu trách nhiệm tương tác trực tiếp Database Driver (pg).
   - Chứa các câu lệnh SQL tĩnh hoặc động (Parameterized Queries để chống SQL Injection).
   - Nhận connection `pool` (hoặc `client` trong Transaction) được tiêm vào từ ngoài.

4. **Database (PostgreSQL):**
   - Schema `service1` gồm 7 bảng cốt lõi: `user_account`, `role`, `permission`, `role_permission`, `employee`, `customer`, `pos_auth`.

---

## 2. Dependency Injection (DI) Flow

Để thuận tiện cho Unit Test (Mock dependencies), cấu trúc DI được thiết lập tại `src/index.js`:

1. Khởi tạo **Repositories** và truyền `pool` (kết nối DB) vào qua tham số hàm (constructor/factory).
2. Khởi tạo **Services** và tiêm (inject) các *Repositories* nó cần vào.
3. Khởi tạo **Express App (`app.js`)** và truyền các *Services* vào. (App/Route không thể chạm trực tiếp vào Repositories hay đối tượng DB `pool`).

---

## 3. Chi tiết các Luồng Hoạt động Core (Core Flows)

### A. Luồng Đăng ký (Transactional Registration)
*Áp dụng khi call `POST /api/auth/register`, tạo Customer mới, hoặc tạo Employee mới.*

1. **Route:** `registerLimiter` chặn request nếu IP spam (giới hạn 5 lần/giờ bảo vệ đăng ký). Nếu qua, chuyển `req.body` cho Service.
2. **Service:**
   - Validate field và độ dài mật khẩu.
   - Truy vấn `userRepo.findByUsername` và `findByEmail` để check trùng. Nếu có, throw `ConflictError`.
   - Băm mật khẩu bằng `bcrypt.hash(password, 10)` (Salt Rounds trung tâm).
   - Lấy `role_id` từ `roleRepo`.
   - **Bắt đầu Transaction:** Gọi `pool.query('BEGIN')`.
   - Tạo bản ghi chính trong `user_account` (`userRepo.createWithClient`).
   - Lấy `user_id` trả về, tiếp tục tạo bản ghi chi tiết tương ứng trong bảng `employee` hoặc `customer`.
   - **Kết thúc Transaction:** Gọi `pool.query('COMMIT')`. Cấu trúc `try-catch` sẽ bắt lỗi (nếu có) và gọi `ROLLBACK` ngay lập tức để giữ an toàn dữ liệu.

### B. Luồng Đăng nhập (Authentication Flow)
*Áp dụng khi call `POST /api/auth/login`.*

1. **Route:** `loginLimiter` kiểm soát giới hạn brute-force (10 lần/15 phút).
2. **Service:**
   - `userRepo.findByUsernameOrEmail`: Tìm User trong DB, throw `UnauthorizedError` nếu không tồn tại.
   - Kiểm tra status `is_active` có bằng true không.
   - `bcrypt.compare()` đối chiếu mật khẩu truyền vào với hash lưu trong DB.
   - Gọi `userRepo.getPermissions(userId)` lấy mảng quyền hạn.
   - Tại `generateToken()`, đóng gói claims (payload) chứa User ID, Role, Permissions. Set thời hạn JWT (`TOKEN_EXPIRY.ACCESS`).
   - Cập nhật `last_login` vào bảng `user_account`.
   - Lưu trữ token id vào `auth_session` để quản lý việc logout (Revocation).
3. **Route:** Format JSON chuẩn chứa thông tin User Profile kèm Access Token JWT trả về.

### C. Luồng Middleware Kiểm tra Quyền (Authorization Flow)
*Áp dụng khi client chạm vào các Endpoint cần bảo vệ (VD: `GET /api/employees`).*

1. **Auth Middleware:** Trích xuất Access Token từ Header `Authorization: Bearer <token>`.
2. Kiểm tra tính toàn vẹn (Signature validation & Expiration check) của JWT thông qua `jsonwebtoken`. Nếu lỗi -> Trả ngay `401 Unauthorized`.
3. Nếu JWT hợp lệ, middleware gắn lại payload đó vào `req.user`. Lúc này request có context về user hiện tại.
4. Tới middleware cấp 2: `requirePermission('employee.view')` sẽ kiểm đếm `req.user.permissions` để phát hiện user có chuỗi quyền yêu cầu không. Nếu không -> Trả ngay `403 Forbidden`.
5. Cuối cùng, Route Handler gọi xuống Service bắt đầu xử lý nghiệp vụ thực sự.

### D. Luồng POS Login (Nhân viên dùng mã PIN nhanh)
*Bảo mật tại quầy thu ngân với xác thực 2 bước: Employee Code (username đặc biệt) + PIN Code (4 số).*

1. **Service `posLogin`:**
   - Tìm account bằng Employee Code.
   - Tham chiếu bảng `pos_auth`. Nếu chức năng POS bị disabled hoặc `locked_until` chưa qua -> Từ chối.
   - Mã PIN check qua thuật toán bcrypt (Không lưu plain-text PIN).
   - **Sai PIN:** Service tăng biến đếm `failed_attempts` lên 1. Khi vượt quá 5 lần, cập nhật `locked_until` đẩy tài khoản POS vào trạng thái lock (15 phút).
   - **Đúng PIN:** Service tạo token chuyên biệt cho POS (hiệu lực 12 giờ), đồng thời reset các flags cảnh báo login sai về 0.

### E. Luồng Phân trang (Pagination)
*Áp dụng cho các GET list (VD: `GET /api/customers?page=2&limit=50`).*

1. **Route:** Rút trích `page` và `limit` mặc định từ URL Query.
2. **Service:** Truyền params xuống Repository thay cho model.
3. **Repository:**
   - Tính toán `OFFSET = (page - 1) * limit`.
   - Thực thi song song:
     - 1. `SELECT COUNT(*)` lấy tổng lượng data (Total Items).
     - 2. `SELECT ... LIMIT {X} OFFSET {Y}` lấy dữ liệu phân trang.
4. **Route:** Hàm helper `paginated(res, data)` đóng gói `items`, tổng số trang (`totalPages`), trang hiện tại, thành JSON trả client.

---

## 4. Quality Standards đã đảm bảo trong Service
- **Bảo mật chuyên sâu:** Hash mọi dữ liệu mật (password, pin), JWT auth stateless, Parameterized Queries bảo vệ Database khỏi bóc vỏ SQL Injection, trang bị Anti-Brute-Force Limiters, Auto-Lockout Account.
- **Tính trọn vẹn (Data Integrity):** Triển khai Transaction DB ở mức pool client (các table logic gộp chặt với nhau).
- **Code Xanh (Clean Code):** Dùng `constants` tránh Magic Numbers. Không code duplicate.
- **Testable Design:** Phân tách hoàn toàn Business Logics khỏi Network Requests. Unit Tests có thể chạy trên Repository Mocks mà không cần DB thật với 100% Core coverage.
