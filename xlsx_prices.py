"""Small, dependency-free XLSX reader/writer for the pricing exchange template."""
import io, zipfile, re, xml.etree.ElementTree as ET
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
N={'m':NS}
def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('Недопустимый XML.')
    return ET.fromstring(data)
def export_prices(data,seed):
    rows=[['Артикул','Цена, ₽','Название','Категория']]+[[m['id'],data['prices'][m['id']],m['sku']+' · '+m['name'],m['category']] for m in seed['modules']]+[[f'ST-{n}',data['worktops'][n],f'Столешница {n} мм','Столешницы'] for n in ('1000','1500')]
    sheet=ET.Element('worksheet',xmlns=NS); sd=ET.SubElement(sheet,'sheetData')
    for i,row in enumerate(rows,1):
        r=ET.SubElement(sd,'row',r=str(i))
        for j,v in enumerate(row):
            c=ET.SubElement(r,'c',r=f'{chr(65+j)}{i}')
            if isinstance(v,int): ET.SubElement(c,'v').text=str(v)
            else:
                c.set('t','inlineStr'); ET.SubElement(ET.SubElement(c,'is'),'t').text=v
    f=io.BytesIO()
    with zipfile.ZipFile(f,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''')
        z.writestr('_rels/.rels','''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''')
        z.writestr('xl/workbook.xml',f'''<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Цены" sheetId="1" r:id="rId1"/></sheets></workbook>''')
        z.writestr('xl/_rels/workbook.xml.rels','''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>''')
        z.writestr('xl/worksheets/sheet1.xml',ET.tostring(sheet,encoding='utf-8',xml_declaration=True))
    return f.getvalue()
def import_prices(raw,seed):
    if len(raw)>2_000_000: raise ValueError('Файл больше 2 МБ.')
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        if len(z.infolist())>300 or sum(i.file_size for i in z.infolist())>15_000_000: raise ValueError('Слишком большой XLSX.')
        workbook=xml(z.read('xl/workbook.xml')); sheets=workbook.findall('m:sheets/m:sheet',N)
        if len(sheets)!=1: raise ValueError('Нужен один лист в формате экспортированного прайса.')
        rel=xml(z.read('xl/_rels/workbook.xml.rels')); rid=sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target=next((r.get('Target') for r in rel if r.get('Id')==rid and r.get('TargetMode')!='External'),None)
        if not target: raise ValueError('Лист не найден.')
        path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
        if not re.fullmatch(r'xl/worksheets/[^/]+\.xml',path): raise ValueError('Неподдерживаемый лист.')
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            shared=[''.join(t.text or '' for t in si.findall('.//m:t',N)) for si in xml(z.read('xl/sharedStrings.xml')).findall('m:si',N)]
        rows=[]
        for r in xml(z.read(path)).findall('m:sheetData/m:row',N):
            cells={}
            for c in r.findall('m:c',N):
                col=re.match(r'[A-Z]+',c.get('r',''))
                if not col: continue
                v=c.findtext('m:v',default='',namespaces=N); t=c.get('t')
                if c.find('m:f',N) is not None and col[0] in ('A','B'): raise ValueError('Формулы в колонках A/B не поддерживаются. Вставьте значения.')
                if t=='s': v=shared[int(v)]
                if t=='inlineStr': v=''.join(x.text or '' for x in c.findall('.//m:t',N))
                cells[col[0]]=v.strip()
            if cells.get('A') or cells.get('B'): rows.append((r.get('r','?'),cells.get('A',''),cells.get('B','')))
    if not rows or rows[0][1].lower()!='артикул' or not rows[0][2].lower().startswith('цена'): raise ValueError('В первой строке нужны колонки «Артикул» и «Цена, ₽». Используйте экспортированный шаблон.')
    allowed={m['id'] for m in seed['modules']}; prices={}; tops={}; seen=set()
    for n,key,value in rows[1:]:
        if key in seen: raise ValueError(f'Строка {n}: повтор артикула {key}.')
        if key not in allowed and key not in ('ST-1000','ST-1500'): raise ValueError(f'Строка {n}: неизвестный артикул {key}.')
        if not re.fullmatch(r'\d+(?:\.0+)?',value) or not 1<=int(value.split('.')[0])<=100000000: raise ValueError(f'Строка {n}: цена должна быть положительным целым числом.')
        seen.add(key); (tops if key.startswith('ST-') else prices)[key[3:] if key.startswith('ST-') else key]=int(value.split('.')[0])
    if not seen: raise ValueError('Нет цен для импорта.')
    return {'prices':prices,'worktops':tops}
