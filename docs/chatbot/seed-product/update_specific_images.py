import re
import urllib.request
import urllib.parse
import json
import time

def get_image(query):
    try:
        url = "https://www.bing.com/images/search?q=" + urllib.parse.quote(query)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        
        matches = re.findall(r'm="(\{.*?\})"', html)
        if matches:
            for m in matches:
                try:
                    data = json.loads(m.replace('&quot;', '"'))
                    if 'murl' in data:
                        ext = data['murl'].lower()
                        if ext.endswith('.jpg') or ext.endswith('.png') or ext.endswith('.jpeg') or ext.endswith('.webp'):
                            return data['murl']
                except:
                    continue
    except Exception as e:
        print(f"Error fetching {query}: {e}")
    return None

import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('seed.sql', 'r', encoding='utf-8') as f:
    sql_content = f.read()

pattern = re.compile(r"(\(\s*(\d+)\s*,\s*\d+,\s*')([^']+)('\s*,\s*')([^']+)('\s*,\s*\d+,\s*(TRUE|FALSE),\s*'[^']+'\s*\))")

lines = sql_content.split('\n')
new_lines = []

target_ids = {
    5: "Bún tươi Ba Khánh 500g coopmart",
    15: "Phở bò Vifon 80g siêu thị",
    20: "Snack khoai tây Lays tự nhiên 52g",
    23: "Cà chua cherry đà lạt 500g",
    29: "Thăn ngoại bò Úc Hokubee bít tết",
    33: "Há cảo tôm thịt Cầu Tre 500g siêu thị",
    34: "Xúc xích phô mai CP 500g",
    40: "chai Trà Ô long Tea plus 455ml",
    41: "lon Nước tăng lực Red bull 250ml",
    48: "chai Dầu đậu nành Simply 2 lít",
    60: "hũ Đậu phộng da cá Tân Tân 275g"
}

for line in lines:
    match = pattern.search(line)
    if match:
        prefix = match.group(1)
        product_id = int(match.group(2))
        product_name = match.group(3)
        middle = match.group(4)
        old_url = match.group(5)
        suffix = match.group(6)
        
        if product_id in target_ids:
            print(f"Searching image for ID {product_id}: {product_name}", flush=True)
            search_query = target_ids[product_id]
            
            new_url = get_image(search_query)
            
            if not new_url:
                new_url = old_url
                
            new_url = new_url.replace("'", "''")
            
            # The regex matches something like prefix="(\(\s*5\s*,\s*105,\s*'Ba chỉ..."
            # Wait, prefix includes the id! 
            # match.start() ... line[:match.start()]
            
            new_line = line[:match.start()] + prefix + product_name + middle + new_url + suffix + line[match.end():]
            new_lines.append(new_line)
            print(f"Replaced with {new_url}", flush=True)
            time.sleep(1.5)
        else:
            new_lines.append(line)
    else:
        new_lines.append(line)

with open('seed.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print("Done updating specific images.", flush=True)
