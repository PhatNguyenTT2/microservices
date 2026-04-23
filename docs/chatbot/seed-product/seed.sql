-- ============================================================
-- CATALOG SEED DATA - DỰ ÁN SIÊU THỊ MINI
-- File: services/catalog/src/db/seed.sql
-- ============================================================

BEGIN;

-- ==========================================
-- 1. ROOT CATEGORIES (ID 1-10)
-- ==========================================
INSERT INTO category (id, parent_id, name, image_url, description, sort_order, is_perishable)
OVERRIDING SYSTEM VALUE
VALUES
  (1, NULL, 'Rau củ, trái cây', NULL, 'Rau, củ, quả tươi sống', 1, TRUE),
  (2, NULL, 'Thịt, trứng, hải sản', NULL, 'Thịt các loại, hải sản tươi', 2, TRUE),
  (3, NULL, 'Thức ăn chế biến, bún tươi', NULL, 'Đồ ăn nấu sẵn, chả giò, bún', 3, TRUE),
  (4, NULL, 'Sữa, sản phẩm từ sữa', NULL, 'Sữa tươi, chua, phô mai', 4, TRUE),
  (5, NULL, 'Thực phẩm đông, mát', NULL, 'Kem, thực phẩm đông lạnh', 5, TRUE),
  (6, NULL, 'Thức uống', NULL, 'Nước giải khát, trà, cà phê', 6, FALSE),
  (7, NULL, 'Mì, cháo, phở ăn liền', NULL, 'Đồ ăn liền các loại', 7, FALSE),
  (8, NULL, 'Gạo, bột, đồ khô', NULL, 'Gạo, các loại bột mì', 8, FALSE),
  (9, NULL, 'Dầu ăn, gia vị', NULL, 'Gia vị nấu ăn, nước mắm', 9, FALSE),
  (10, NULL, 'Bánh, kẹo, snack', NULL, 'Đồ ăn vặt, bánh quy', 10, FALSE);

-- ==========================================
-- 2. SUBCATEGORIES (ID 101-125)
-- ==========================================
INSERT INTO category (id, parent_id, name, image_url, description, sort_order, is_perishable)
OVERRIDING SYSTEM VALUE
VALUES
  -- Từ Root 1: Rau củ quả
  (101, 1, 'Rau lá', NULL, 'Rau xanh các loại', 1, TRUE),
  (102, 1, 'Rau củ', NULL, 'Củ quả nấu canh, xào', 2, TRUE),
  (103, 1, 'Trái cây', NULL, 'Trái cây nội và ngoại', 3, TRUE),
  
  -- Từ Root 2: Thịt trứng hải sản
  (104, 2, 'Thịt heo', NULL, 'Thịt heo tươi', 1, TRUE),
  (105, 2, 'Thịt bò', NULL, 'Thịt bò các loại', 2, TRUE),
  (106, 2, 'Trứng', NULL, 'Trứng gà, vịt, cút', 3, TRUE),
  (107, 2, 'Hải sản', NULL, 'Cá, tôm, mực', 4, TRUE),

  -- Từ Root 3: Chế biến
  (108, 3, 'Chế biến sẵn', NULL, 'Xúc xích, lạp xưởng, chả', 1, TRUE),
  (109, 3, 'Bún, phở tươi', NULL, 'Bún tươi, bánh phở', 2, TRUE),

  -- Từ Root 4: Sữa
  (110, 4, 'Sữa tươi', NULL, 'Sữa bịch, hộp, chai', 1, TRUE),
  (111, 4, 'Sữa chua & Phô mai', NULL, 'Sữa chua ăn, uống', 2, TRUE),

  -- Từ Root 5: Đông lạnh
  (112, 5, 'Thực phẩm đông lạnh', NULL, 'Cá viên, bò viên, há cảo', 1, TRUE),
  
  -- Từ Root 6: Thức uống
  (113, 6, 'Nước ngọt có ga', NULL, 'Coca, Pepsi, Sprite', 1, FALSE),
  (114, 6, 'Nước suối & Trà', NULL, 'Nước tinh khiết, trà đóng chai', 2, FALSE),
  (115, 6, 'Bia', NULL, 'Bia lon, chai, thùng', 3, FALSE),

  -- Từ Root 7: Mì cháo
  (116, 7, 'Mì ăn liền', NULL, 'Mì gói, mì ly', 1, FALSE),
  (117, 7, 'Phở, bún khô', NULL, 'Phở gói, miến khô', 2, FALSE),

  -- Từ Root 8: Gạo bột
  (118, 8, 'Gạo', NULL, 'Gạo tẻ, nếp, gạo lứt', 1, FALSE),
  (119, 8, 'Nông sản khô', NULL, 'Nấm hương, mộc nhĩ, đậu', 2, FALSE),

  -- Từ Root 9: Gia vị
  (120, 9, 'Dầu ăn', NULL, 'Dầu đậu nành, hướng dương', 1, FALSE),
  (121, 9, 'Gia vị tẩm ướp', NULL, 'Bột ngọt, hạt nêm, gia vị lẩu', 2, FALSE),
  (122, 9, 'Nước chấm', NULL, 'Nước mắm, tương ớt, xì dầu', 3, FALSE),

  -- Từ Root 10: Bánh kẹo
  (123, 10, 'Bánh mì & Bánh ngọt', NULL, 'Bánh sandwich, croissant', 1, FALSE),
  (124, 10, 'Bánh quy & Kẹo', NULL, 'Bánh xốp, kẹo mút', 2, FALSE),
  (125, 10, 'Snack & Đồ nhắm', NULL, 'Bim bim, khô gà, hạt điều', 3, FALSE);

-- Reset sequence cho Category
SELECT setval(pg_get_serial_sequence('category', 'id'), (SELECT MAX(id) FROM category));

-- ==========================================
-- 3. PRODUCTS (ID 1-60)
-- Cập nhật dữ liệu ảnh thực tế / Cấu trúc CDN chuẩn
-- ==========================================
INSERT INTO product (id, category_id, name, image_url, unit_price, is_active, vendor)
OVERRIDING SYSTEM VALUE
VALUES
  -- ---------------------------------------------------------
  -- CỤM 1: NẤU LẨU TẠI NHÀ (Để test Apriori Cross-sell)
  -- ---------------------------------------------------------
  (1, 105, 'Ba chỉ bò Mỹ thái lát mỏng khay 500g', 'https://misolhouse.com/assets/uploads/fa7273540c9b506a9dcfedd9e9ef8364.jpg', 125000, TRUE, 'Excel Beef'),
  (2, 102, 'Nấm kim châm Hàn Quốc gói 150g', 'https://cdn.tgdd.vn/Products/Images/8820/226959/bhx/nam-kim-cham-han-quoc-goi-150g-202205181701291485.jpg', 18000, TRUE, 'BioMushroom'),
  (3, 101, 'Rau muống VietGAP bó 500g', 'https://bentre.farm/img_data/images/Rau cai sach/IMG_20230905_162136.png', 15000, TRUE, 'VinEco'),
  (4, 121, 'Gia vị nêm sẵn lẩu Thái Barona 80g', 'https://soramart94.com/wp-content/uploads/2023/10/E3170857-A6C7-4232-8845-398824B6DE4B.jpeg', 16000, TRUE, 'Barona'),
  (5, 109, 'Bún tươi Ba Khánh gói 500g', 'https://brademar.com/wp-content/uploads/2022/10/Danh-muc-san-pham-cua-Coopmart-bao-gom-Thuc-an-che-bien-bun-tuoi.jpg', 12000, TRUE, 'Ba Khánh'),
  (6, 112, 'Cá viên chiên xâu tôm viên Vissan 500g', 'https://thucphamnhanh.com/wp-content/uploads/2020/09/ga-vien-vissan-loai-250g.jpg', 55000, TRUE, 'Vissan'),

  -- ---------------------------------------------------------
  -- CỤM 2: BỮA SÁNG NHANH & DỮ LIỆU LẺ/SỈ (Test Personalization)
  -- ---------------------------------------------------------
  (7, 123, 'Bánh mì Sandwich lạt Kinh Đô 275g', 'https://img.youtube.com/vi/yKoo9HCzZO4/hq720.jpg', 22000, TRUE, 'Kinh Đô'),
  (8, 110, 'Lốc 4 hộp Sữa tươi tiệt trùng Vinamilk 100% không đường 180ml', 'https://suatabaonam.vn/uploads/shops/2017_09/fm100_gf_rid_180_4_1.png', 33000, TRUE, 'Vinamilk'),
  (9, 110, 'Thùng 48 hộp Sữa tươi tiệt trùng Vinamilk không đường 180ml (Giá sỉ)', 'https://suatabaonam.vn/uploads/shops/2017_09/fm100_gf_rid_180_4_1.png', 385000, TRUE, 'Vinamilk'), 
  (10, 106, 'Trứng gà sạch V.Food hộp 10 quả', 'https://www.lottemart.vn/media/catalog/product/cache/0x0/8/9/8936013681078-2.jpg.webp', 35000, TRUE, 'V.Food'),
  (11, 108, 'Xúc xích heo tiệt trùng Vissan gói 4 cây', 'https://www.lottemart.vn/media/catalog/product/8/9/8934572174345.jpg', 20000, TRUE, 'Vissan'),

  -- ---------------------------------------------------------
  -- CỤM 3: MÌ GÓI & THỨC ĂN SINH VIÊN (Test Semantic Search)
  -- ---------------------------------------------------------
  (12, 116, 'Mì Hảo Hảo hương vị tôm chua cay 75g', 'https://vn-test-11.slatic.net/p/ef7f242672de955c427d2645671430b8.png', 4500, TRUE, 'Acecook'),
  (13, 116, 'Thùng 30 gói mì Hảo Hảo tôm chua cay (Giá sỉ)', 'https://cherrystore.com.vn/wp-content/uploads/2023/03/Ko-chua-cay.png', 115000, TRUE, 'Acecook'), 
  (14, 116, 'Mì xào khô Indomie vị sườn đặc biệt 85g', 'https://filebroker-cdn.lazada.vn/kf/S325d9d25f7134fe88eb211f1e38c7a12p.jpg', 6000, TRUE, 'Indomie'),
  (15, 117, 'Phở bò Vifon gói 80g', 'https://www.vifon.vn/vnt_upload/weblink/Pho-VF-fv.png', 8000, TRUE, 'Vifon'),
  (16, 117, 'Miến dong Phú Hương sườn heo', 'https://www.sieuthiminitunjp.com/wp-content/uploads/2023/11/Miến-Phú-Hương-Vị-Sườn-Heo.jpg', 9500, TRUE, 'Acecook'),

  -- ---------------------------------------------------------
  -- CỤM 4: GIẢI KHÁT & ĐỒ NHẬM (Test Bundle Upsell)
  -- ---------------------------------------------------------
  (17, 115, 'Bia Heineken Silver lon 330ml', 'https://cdn.tgdd.vn/Products/Images/2282/310252/bhx/6-lon-bia-heineken-silver-250ml-202307071026364837.jpg', 19500, TRUE, 'Heineken'),
  (18, 115, 'Thùng 24 lon bia Tiger Bạc (Tiger Crystal) 330ml', 'https://photos.icheckcdn.net/N47hNnyPSrcAPVmkmyohMhH2Ctgsb_k4nHLwMjngXZM.jpg', 395000, TRUE, 'Tiger'), 
  (19, 113, 'Nước ngọt Coca-Cola vị nguyên bản chai 390ml', 'https://www.satrafoods.com.vn/uploads/san-pham-cung-loai/172.jpg', 9000, TRUE, 'Coca-Cola'),
  (20, 125, 'Snack khoai tây Lay''s vị Tự nhiên 52g', 'https://cdn.tgdd.vn/Products/Images/3365/76125/bhx/snack-khoai-tay-lays-vi-tu-nhien-52g-1.jpg', 12000, TRUE, 'Lay''s'),
  (21, 125, 'Khô gà lá chanh G kitchen hũ 200g', 'https://nghikitchen.edu.vn/wp-content/uploads/2023/04/99AFF4D0-0343-4133-990B-C0A1DBB9EA9F-scaled.jpeg', 85000, TRUE, 'G Kitchen'),

  -- ---------------------------------------------------------
  -- CÁC SẢN PHẨM KHÁC ĐỂ PHỦ KÍN CATALOG
  -- ---------------------------------------------------------
  -- Rau củ, Trái cây
  (22, 101, 'Cải thìa mỡ VietGAP 500g', 'https://bentre.farm/img_data/images/Rau cai sach/IMG_20230905_162136.png', 16000, TRUE, 'Châu Phát'),
  (23, 102, 'Cà chua mận đỏ Đà Lạt 500g', 'https://vinhtienfood.vn/wp-content/uploads/2021/04/1711359ca-chua-bi.jpg', 25000, TRUE, 'DalatGAP'),
  (24, 102, 'Hành tây vàng loại 1 kg', 'https://dacsanhungyen.com.vn/uploads/images/long-nhan-hung-yen-1kg.jpg', 30000, TRUE, 'Nông sản VN'),
  (25, 103, 'Chuối già Nam Mỹ nải 1kg', 'https://sp-ao.shortpixel.ai/client/to_webp,q_lossless,ret_img,w_570,h_428/https://safco.vn/wp-content/uploads/2022/04/chuoi-gia-giong-nam-my-tui-1kg-202202181730432583-570x428.jpg', 28000, TRUE, 'Dole'),
  (26, 103, 'Cherry đỏ Mỹ size 9.5 (Hộp 500g - Hàng VIP)', 'https://product.hstatic.net/200000157781/product/dsc_1746_copy_965af6bc755d44e1806edda9c3501652_1024x1024.jpg', 250000, TRUE, 'Imported'), 

  -- Thịt & Hải sản
  (27, 104, 'Thịt sườn non heo chuẩn C.P 500g', 'https://chodaumoibinhdien.com.vn/upload/hinhanh/thumb/suon-non-heo-tuoi6495.jpg', 95000, TRUE, 'C.P'),
  (28, 104, 'Thịt ba rọi heo rút sườn 500g', 'https://thitsachnhapkhau.net/wp-content/uploads/2022/02/ba-roi-heo-run-suon-1.jpg', 85000, TRUE, 'C.P'),
  (29, 105, 'Thăn ngoại bò Úc Hokubee cắt bít tết 250g', 'https://bomyhaisan.com/wp-content/uploads/2020/12/bo_hokubee_bomyhaisan_anh_dau_troc_c.jpg', 165000, TRUE, 'Hokubee'),
  (30, 107, 'Tôm sú sinh thái lột vỏ đông lạnh 250g', 'https://product.hstatic.net/200000318501/product/19.-tom-su-sinh-thai-size-30-_500g__1_8b3d3b76f3644071b33c7b23e36248cb_master.png', 125000, TRUE, 'Seafood VN'),
  (31, 107, 'Mực ống làm sạch khay 300g', 'http://file.hstatic.net/200000567893/collection/vien_lam_sach_khay_chinh_nha_oxydens__1__aab909d84475477f9d69c3e91f986e47.png', 98000, TRUE, 'Seafood VN'),

  -- Đồ chế biến
  (32, 108, 'Chả lụa heo G Kitchen đòn 500g', 'https://product.hstatic.net/200000744499/product/gian_hang_chinh_hang_a25d52430da548019f3e3d61e085ae62_grande.png', 95000, TRUE, 'G Kitchen'),
  (33, 108, 'Há cảo tôm thịt mini Cầu Tre 500g', 'https://cjfoods.com.vn/storage/products/dimsum-chay-500g-1200x1200-04-400x400.jpg', 65000, TRUE, 'Cầu Tre'),
  (34, 112, 'Xúc xích xông khói phô mai vòng CP 500g', 'https://hcm.fstorage.vn/images/2022/xuc-xich-pho-mai-cp-bucher-goi-450g_87e93ee8-75b9-44ee-b417-7e4dfcde29e3-og.jpg', 85000, TRUE, 'C.P'),

  -- Sữa & Phô mai
  (35, 110, 'Lốc 4 hộp Sữa tươi TH True Milk có đường 180ml', 'https://cdn1.concung.com/2022/04/56130-86777-large_mobile/sua-tuoi-tiet-trung-th-true-milk-co-duong-180ml-loc-4-hop.png', 34000, TRUE, 'TH True Milk'),
  (36, 111, 'Lốc 4 hộp Sữa chua nha đam Vinamilk 100g', 'https://product.hstatic.net/1000141988/product/sua_chua_nha_dam_vinamilk__100g_x_4_hop_loc__1782a5eb80364c329fa2e8871224fcc2_1024x1024.jpg', 28000, TRUE, 'Vinamilk'),
  (37, 111, 'Phô mai Bò Lúc Lắc hộp 8 miếng 120g', 'https://cdn.tgdd.vn/Products/Images/7599/201194/bhx/pho-mai-con-bo-cuoi-hop-120g-8-mieng-202209091323350769.jpg', 42000, TRUE, 'Bel Group'),

  -- Nước uống
  (38, 114, 'Nước khoáng thiên nhiên La Vie chai 500ml', 'https://nuocsuoitinhkhiet.com/images/thumbs/2017/10/-60.jpg', 6000, TRUE, 'La Vie'),
  (39, 114, 'Nước tinh khiết Aquafina chai 1.5L', 'https://1.bp.blogspot.com/-q7FAgFYcJb0/Xv7Z3Zgi3HI/AAAAAAAAB7s/XjJAWAwxPbUfH53BIuMmglCyYu8FXXWqQCK4BGAsYHg/w1200-h630-p-k-no-nu/aquafina-15l.jpg', 12000, TRUE, 'Suntory Pepsico'),
  (40, 114, 'Trà Ô Long Tea+ Plus chai 455ml', 'https://cdn.tgdd.vn/Products/Images/8938/79209/bhx/files/6-chai-tra-o-long-tea-plus-455ml-202211171326227348.jpg', 10000, TRUE, 'Suntory Pepsico'),
  (41, 113, 'Nước tăng lực Red Bull lon 250ml', 'https://cafefcdn.com/203337114487263232/2024/12/4/bo-huc-vi-pham-1733304390382647869777-1733318543263-17333185437431097837729.jpeg', 12000, TRUE, 'Red Bull'),

  -- Gạo & Đồ khô
  (42, 118, 'Gạo thơm ST25 lúa tôm Ông Cua túi 5kg', 'https://gaominhchau.com/wp-content/uploads/2022/06/gao-st25-lua-tom-ong-cua-5kg-f-500x500-1.png', 185000, TRUE, 'DNTN Hồ Quang Trí'),
  (43, 118, 'Bao Gạo đặc sản ST25 Sóc Trăng 25kg (Giá sỉ)', 'http://iwater.vn/Image/Picture/Gao/Gao-ST25-iWater.jpg', 875000, TRUE, 'DNTN Hồ Quang Trí'), 
  (44, 118, 'Gạo thơm Lài Miên túi 5kg', 'https://sg-live-01.slatic.net/p/e2b3f8278ab5c41cb0939fc545f07f52.jpg', 110000, TRUE, 'Nông sản VN'),
  (45, 119, 'Nấm hương khô Tây Bắc gói 100g', 'https://i.ytimg.com/vi/Y_pXAGhvy3g/maxresdefault.jpg', 45000, TRUE, 'Đặc sản Tây Bắc'),
  (46, 119, 'Đậu đen xanh lòng hạt nhỏ 500g', 'https://gaongonbonmua.com/storage/product/9/z4546592218605_bb8cbb9a3ec09da4e8db1b047170e1fd.jpg', 35000, TRUE, 'Nông sản VN'),

  -- Gia vị
  (47, 120, 'Dầu ăn thực vật Tường An chai 1L', 'https://storage.googleapis.com/teko-gae.appspot.com/media/image/2022/3/21/20220321_e69e0f12-d6e4-4915-8239-ab2e9c074a92.jpg', 48000, TRUE, 'Tường An'),
  (48, 120, 'Dầu đậu nành Simply chai 2L', 'https://product.hstatic.net/200000460455/product/dau_dau_nanh_simply_289c2f92c7f448ac84d4e06d70ad2561_master.png', 125000, TRUE, 'Simply'),
  (49, 122, 'Nước mắm Nam Ngư 11 độ đạm chai 750ml', 'https://cdn.tgdd.vn/Products/Images/2289/76426/bhx/nuoc-mam-nam-ngu-10-do-dam-chai-500ml-201903151028223950.jpg', 32000, TRUE, 'Masan'),
  (50, 122, 'Nước mắm cá cơm Hưng Thịnh 35 độ đạm chai 620ml', 'https://vanmart.vn/thumbs/600x600x1/upload/product/q-3859.jpg', 55000, TRUE, 'Hưng Thịnh'),
  (51, 122, 'Nước tương Chinsu tỏi ớt chai 250ml', 'https://product.hstatic.net/1000288770/product/nuoc_tuong_chinsu_toi_ot_thung_24_chai_x_330ml_86d4341f4f874dfc95fa7de7cb0e6955.jpg', 15000, TRUE, 'Masan'),
  (52, 121, 'Hạt nêm Knorr từ thịt thăn, xương ống gói 400g', 'https://tuoimart.vn/wp-content/uploads/2022/08/e89147d42988ecd6b599.jpg', 38000, TRUE, 'Knorr'),
  (53, 121, 'Bột ngọt Ajinomoto gói 454g', 'https://sg-test-11.slatic.net/p/eaa121cb0aa6afdc85b32a665770bfd9.jpg', 33000, TRUE, 'Ajinomoto'),
  (54, 121, 'Đường tinh luyện Biên Hòa bịch 1kg', 'https://product.hstatic.net/200000416751/product/duong-sach-co-ba-1kg_c6025b1442c54c78b13a58a3b805d96f_master.png', 25000, TRUE, 'Biên Hòa'),

  -- Bánh kẹo & Snack
  (55, 124, 'Bánh quy bơ Danisa hộp thiếc 454g', 'https://open-media.s3-ap-southeast-1.amazonaws.com/chmn/media/shop/2024/07/focad0075-banh-quy-bo-danisa-454g.webp', 135000, TRUE, 'Danisa'),
  (56, 124, 'Bánh xốp phô mai Nabati hộp 150g', 'https://www.cqmart.vn/images/thumbs/0007286_banh-kem-xop-pho-mai-nabati-hop-thiec-300g.jpeg', 28000, TRUE, 'Nabati'),
  (57, 124, 'Kẹo mút Chupa Chups hương trái cây gói 10 que', 'https://img.lazcdn.com/g/p/55e3415a1c9192d914a9585ab1e9c4cf.jpg_720x720q80.jpg', 15000, TRUE, 'Perfetti Van Melle'),
  (58, 123, 'Bánh mì hoa cúc Harrys Brioche Tressée 500g', 'https://thucphamhuuduyen.vn/wp-content/uploads/2021/07/ban-my-hoa-cuc.jpg', 145000, TRUE, 'Harrys'),
  (59, 125, 'Hạt điều rang muối Bình Phước hũ 250g', 'https://www.anhkhoi.vn/imageshh/image/hat-dieu-rang-muoi-binh-phuoc.png', 95000, TRUE, 'Nông sản VN'),
  (60, 125, 'Đậu phộng da cá Tân Tân hũ 275g', 'https://hcm.fstorage.vn/images/2023/06/dau-phong-da-ca-tan-tan-hu-300g-202004241340493916-20230612073553.jpg', 42000, TRUE, 'Tân Tân');

-- Reset sequence cho Product
SELECT setval(pg_get_serial_sequence('product', 'id'), (SELECT MAX(id) FROM product));

COMMIT;