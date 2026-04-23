-- ============================================================
-- SEED 50 CUSTOMERS DATA
-- ============================================================

DO $$
DECLARE
    first_names TEXT[] := ARRAY['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Huynh', 'Phan', 'Vu', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong', 'Ly'];
    mid_names TEXT[] := ARRAY['Van', 'Thi', 'Huu', 'Ngoc', 'Minh', 'Xuan', 'Thu', 'Hoang', 'Quang', 'Gia'];
    last_names TEXT[] := ARRAY['Anh', 'Binh', 'Chau', 'Dung', 'Phong', 'Giang', 'Hai', 'Linh', 'Khanh', 'Lan', 'Minh', 'Ngoc', 'Oanh', 'Phuc', 'Quang', 'Tuan', 'Thao', 'Trang', 'Son', 'Vinh', 'Yen'];
    districts TEXT[] := ARRAY['Quận 1', 'Quận 3', 'Quận 5', 'Quận 7', 'Quận 10', 'Bình Thạnh', 'Phú Nhuận', 'Tân Bình', 'Gò Vấp', 'Thành phố Thủ Đức'];
BEGIN
    INSERT INTO customer (user_id, full_name, phone, address, gender, dob, total_spent, customer_type, is_active)
    SELECT 
        NULL AS user_id,
        first_names[floor(random() * array_length(first_names, 1)) + 1] || ' ' || 
        mid_names[floor(random() * array_length(mid_names, 1)) + 1] || ' ' || 
        last_names[floor(random() * array_length(last_names, 1)) + 1] AS full_name,
        '09' || lpad(floor(random() * 100000000)::text, 8, '0') AS phone,
        floor(random() * 500 + 1)::text || ' ' || 
        (ARRAY['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Lê Duẩn', 'Nguyễn Thị Minh Khai', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Phạm Văn Đồng', 'Nguyễn Văn Cừ', 'Pasteur'])[floor(random() * 10) + 1] || ', ' ||
        districts[floor(random() * array_length(districts, 1)) + 1] || ', TP.HCM' AS address,
        (ARRAY['Male', 'Female', 'Other'])[floor(random() * 3) + 1] AS gender,
        (CURRENT_DATE - floor(random() * 14600 + 6570)::int) AS dob, -- age between 18 and 58
        0 AS total_spent,
        (ARRAY['retail', 'wholesale', 'vip', 'Guest'])[floor(random() * 4) + 1] AS customer_type,
        TRUE AS is_active
    FROM generate_series(1, 50);
END $$;
