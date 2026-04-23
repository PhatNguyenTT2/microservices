import urllib.request
import urllib.parse
import json
import re

items = [
    "Bún tươi Ba Khánh gói 500g",
    "Phở bò Vifon gói 80g",
    "Snack khoai tây Lay's vị Tự nhiên 52g",
    "Cà chua mận đỏ Đà Lạt 500g",
    "Thăn ngoại bò Úc Hokubee cắt bít tết 250g",
    "Há cảo tôm thịt mini Cầu Tre 500g",
    "Xúc xích xông khói phô mai vòng CP 500g",
    "Trà Ô Long Tea Plus chai 455ml",
    "Nước tăng lực Red Bull lon 250ml",
    "Dầu đậu nành Simply chai 2L",
    "Đậu phộng da cá Tân Tân hũ 275g"
]

def search(query):
    url = "https://www.bing.com/images/search?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
    matches = re.findall(r'm="(\{.*?\})"', html)
    found = []
    if matches:
        for m in matches:
            try:
                data = json.loads(m.replace('&quot;', '"'))
                if 'murl' in data:
                    ext = data['murl'].lower()
                    if ext.endswith('.jpg') or ext.endswith('.png') or ext.endswith('.jpeg') or ext.endswith('.webp'):
                        found.append(data['murl'])
                        if len(found) >= 3:
                            break
            except:
                continue
    return found

import sys
sys.stdout.reconfigure(encoding='utf-8')

for item in items:
    print(f"--- {item} ---")
    urls = search(item + " Bách Hóa Xanh")
    for u in urls:
        print(u)
