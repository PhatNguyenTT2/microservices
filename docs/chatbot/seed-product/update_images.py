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

pattern = re.compile(r"(\(\d+,\s*\d+,\s*')([^']+)('\s*,\s*')([^']+)('\s*,\s*\d+,\s*(TRUE|FALSE),\s*'[^']+'\s*\))")

lines = sql_content.split('\n')
new_lines = []

for line in lines:
    match = pattern.search(line)
    if match:
        prefix = match.group(1)
        product_name = match.group(2)
        middle = match.group(3)
        old_url = match.group(4)
        suffix = match.group(5)
        
        print(f"Searching image for: {product_name}", flush=True)
        search_query = f"{product_name} sản phẩm"
        
        new_url = get_image(search_query)
        
        if not new_url:
            new_url = old_url
            
        new_url = new_url.replace("'", "''")
        new_line = line[:match.start()] + prefix + product_name + middle + new_url + suffix + line[match.end():]
        new_lines.append(new_line)
        print(f"Replaced with {new_url}", flush=True)
        time.sleep(1.5) # Anti-ban delay
    else:
        new_lines.append(line)

with open('seed.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

print("Done updating images.", flush=True)
