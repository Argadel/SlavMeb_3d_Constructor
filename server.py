"""Local-only test server. Never expose to the internet."""
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
from http.cookies import SimpleCookie
import base64, binascii, zipfile, xml.etree.ElementTree as ET
from xlsx_prices import export_prices, import_prices
import json, secrets, hashlib, hmac, time, getpass, os, re, sys, webbrowser
from datetime import date, datetime, timezone
ROOT=Path(__file__).resolve().parent
PUBLIC=ROOT/'public'; PRIVATE=ROOT/'admin-private'
SEED=json.loads((PRIVATE/'catalog-seed.json').read_text(encoding='utf-8'))
DB=PRIVATE/'pricing.json'; ACCOUNT=PRIVATE/'account.json'
SESSIONS={}; failures=[]; TTL=1800
HOST='127.0.0.1'; PORT=8080; ORIGIN=f'http://{HOST}:{PORT}'

def write_json(path,data):
    tmp=path.with_suffix('.tmp'); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8'); os.replace(tmp,path)
def read_json(path): return json.loads(path.read_text(encoding='utf-8'))
def derive(password,salt): return hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
def password_valid(p):
    return 12 <= len(p) <= 256

def setup_password():
    if os.name == 'nt' and '--console-password' not in sys.argv:
        try:
            import tkinter as tk
            from tkinter import simpledialog, messagebox
            window = tk.Tk()
        except Exception as exc:
            print('Графическое окно недоступно. Используем ввод в консоли.', flush=True)
        else:
            try:
                window.withdraw()
                window.attributes('-topmost', True)
                print('Создайте пароль в открывшемся окне Windows.', flush=True)
                while True:
                    p = simpledialog.askstring('Славная мебель — первый запуск', 'Придумайте пароль администратора (12–256 символов):', show='*', parent=window)
                    if p is None: raise SystemExit('Создание пароля отменено. Запустите программу снова.')
                    if not password_valid(p):
                        messagebox.showerror('Проверьте пароль', 'Пароль должен содержать от 12 до 256 символов.', parent=window)
                        continue
                    confirm = simpledialog.askstring('Славная мебель — первый запуск', 'Повторите пароль:', show='*', parent=window)
                    if confirm is None: raise SystemExit('Создание пароля отменено. Запустите программу снова.')
                    if p == confirm: return p
                    messagebox.showerror('Проверьте пароль', 'Пароли не совпадают.', parent=window)
            finally:
                window.destroy()
    print('Первый запуск. Создайте пароль администратора (12–256 символов). При вводе символы не видны. Нажмите Enter после ввода.', flush=True)
    while True:
        p=getpass.getpass('Пароль: ')
        if password_valid(p) and p==getpass.getpass('Повторите пароль: '): return p
        print('Пароли не совпадают или длина пароля вне допустимого диапазона.', flush=True)

def init():
    if not ACCOUNT.exists():
        p=setup_password()
        salt=secrets.token_hex(16); write_json(ACCOUNT,{'salt':salt,'hash':derive(p,salt)})
    if not DB.exists(): write_json(DB,{'revision':1,'prices':{m['id']:m['price'] for m in SEED['modules']},'worktops':{str(x['length']):x['price'] for x in SEED['worktops']},'promo':{'enabled':False,'name':'Скидка на кухонный гарнитур','percent':10,'target':'furniture','start':'','end':''}})
def snapshot(data):
    return {k:data[k] for k in ('revision','prices','worktops','promo')}
def public_data():
    data=snapshot(read_json(DB)); p=data['promo']; today=date.today().isoformat()
    data['promo']={**p,'active':bool(p['enabled'] and p['percent']>0 and (not p['start'] or p['start']<=today) and (not p['end'] or today<=p['end']))}
    return data

def validate(data):
    old=read_json(DB)
    if type(data.get('revision')) is not int or data['revision']!=old['revision']: raise ValueError('Прайс уже изменён. Обновите страницу.')
    def price_dict(key,keys):
        vals=data.get(key)
        if not isinstance(vals,dict) or set(vals)!=set(keys): raise ValueError('Неполный список цен.')
        if any(type(v) is not int or not 1<=v<=100000000 for v in vals.values()): raise ValueError('Цена должна быть целым числом от 1 до 100 000 000 ₽.')
        return vals
    prices=price_dict('prices',[m['id'] for m in SEED['modules']]); tops=price_dict('worktops',['1000','1500'])
    p=data.get('promo',{}); name=p.get('name'); pct=p.get('percent'); target=p.get('target'); enabled=p.get('enabled'); scope=p.get('scope','')
    if type(enabled) is not bool or not isinstance(name,str) or not name.strip() or len(name)>100 or type(pct) is not int or not 0<=pct<=100 or target not in ('furniture','worktop','all','category','article'): raise ValueError('Проверьте параметры акции.')
    if target=='category' and scope not in {m['category'] for m in SEED['modules']}: raise ValueError('Выберите категорию акции.')
    if target=='article' and scope not in prices: raise ValueError('Выберите артикул акции.')
    if target not in ('category','article'): scope=''
    dates=[]
    for k in ('start','end'):
        v=p.get(k,'')
        if not isinstance(v,str) or (v and (not re.fullmatch(r'\d{4}-\d{2}-\d{2}',v) or date.fromisoformat(v).isoformat()!=v)): raise ValueError('Некорректная дата.')
        dates.append(v)
    if all(dates) and dates[0]>dates[1]: raise ValueError('Дата окончания раньше начала.')
    return {'revision':old['revision']+1,'prices':prices,'worktops':tops,'promo':{'enabled':enabled,'name':name.strip(),'percent':pct,'target':target,'scope':scope,'start':dates[0],'end':dates[1]}}

def digest(data): return hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def changes(old,new):
    rows=[]
    for key in ('prices','worktops'):
        for id,v in new[key].items():
            if old[key][id]!=v: rows.append({'label':id if key=='prices' else 'Столешница '+id+' мм','before':old[key][id],'after':v})
    for k in ('enabled','name','percent','target','scope','start','end'):
        a,b=old['promo'].get(k,''),new['promo'].get(k,'')
        if a!=b: rows.append({'label':'Акция: '+k,'before':a,'after':b})
    return rows

def commit(updated):
    old=read_json(DB); history=old.get('history',[])
    history.append({'saved_at':datetime.now(timezone.utc).isoformat(),'data':snapshot(old),'changes':changes(old,updated)})
    write_json(DB,{**updated,'history':history[-100:]})

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(PUBLIC),**kw)
    def end_headers(self):
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('X-Frame-Options','DENY'); self.send_header('Referrer-Policy','no-referrer'); super().end_headers()
    def reply(self,status,data,kind='application/json; charset=utf-8',cookie=None):
        body=(json.dumps(data,ensure_ascii=False) if kind.startswith('application/json') else data).encode('utf-8'); self.send_response(status); self.send_header('Content-Type',kind); self.send_header('Content-Length',str(len(body)))
        if cookie: self.send_header('Set-Cookie',cookie)
        self.end_headers(); self.wfile.write(body)
    def download(self,body,kind,name):
        self.send_response(200); self.send_header('Content-Type',kind); self.send_header('Content-Disposition',f'attachment; filename="{name}"'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def session(self):
        try:
            c=SimpleCookie(self.headers.get('Cookie','')); token=c['slavnaya_admin'].value; s=SESSIONS.get(token)
            if s and time.monotonic()-s['last']<TTL: s['last']=time.monotonic(); return token,s
            SESSIONS.pop(token,None)
        except (KeyError,ValueError): pass
        return None,None
    def page(self,name): self.reply(200,(PRIVATE/name).read_text(encoding='utf-8'),'text/html; charset=utf-8')
    def host_ok(self): return self.headers.get('Host')==f'{HOST}:{PORT}'
    def do_GET(self):
        if not self.host_ok(): return self.reply(403,{'error':'Используйте 127.0.0.1:8080'})
        path=urlsplit(self.path).path
        if path=='/api/prices': return self.reply(200,public_data())
        if path in ('/admin','/admin/'): return self.page('admin.html' if self.session()[1] else 'login.html')
        if path.startswith('/api/admin/'):
            _,s=self.session()
            if not s: return self.reply(401,{'error':'Войдите в админку.'})
            if path=='/api/admin/prices': return self.reply(200,{**public_data(),'catalog':SEED['modules'],'csrf':s['csrf']})
            if path=='/api/admin/export': return self.download(export_prices(public_data(),SEED),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','slavnaya-prices.xlsx')
            if path=='/api/admin/backup': return self.download(json.dumps(snapshot(read_json(DB)),ensure_ascii=False,indent=2).encode(),'application/json','slavnaya-pricing-backup.json')
            if path=='/api/admin/history': return self.reply(200,{'entries':[{'revision':h['data']['revision'],'saved_at':h['saved_at'],'changes':h['changes']} for h in reversed(read_json(DB).get('history',[]))]})
        if path=='/' or path=='/index.html' or path.startswith(('/assets/','/src/','/data/')):
            file=Path(self.translate_path(path)).resolve()
            if file.is_file() and file.is_relative_to(PUBLIC): return super().do_GET()
            if path=='/': return super().do_GET()
        return self.reply(404,{'error':'Не найдено'})
    def do_HEAD(self): self.reply(405,{'error':'Метод не поддерживается'})
    def do_POST(self):
        if not self.host_ok() or self.headers.get('Origin')!=ORIGIN: return self.reply(403,{'error':'Недопустимый источник запроса.'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json': return self.reply(415,{'error':'Требуется JSON.'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=3000000: raise ValueError()
            data=json.loads(self.rfile.read(n))
            if not isinstance(data,dict): raise ValueError()
        except Exception: return self.reply(400,{'error':'Некорректный запрос.'})
        path=urlsplit(self.path).path
        if path=='/api/admin/login':
            now=time.monotonic(); failures[:]=[t for t in failures if now-t<60]
            if len(failures)>=5: return self.reply(429,{'error':'Слишком много попыток. Повторите через минуту.'})
            account=read_json(ACCOUNT); pw=data.get('password','')
            if data.get('login')!='admin' or not isinstance(pw,str) or len(pw)>256 or not hmac.compare_digest(derive(pw,account['salt']),account['hash']):
                failures.append(now); return self.reply(401,{'error':'Неверный логин или пароль.'})
            failures.clear(); old,_=self.session(); SESSIONS.pop(old,None); token=secrets.token_urlsafe(32); SESSIONS[token]={'last':now,'csrf':secrets.token_urlsafe(32)}
            return self.reply(200,{'ok':True},cookie=f'slavnaya_admin={token}; Path=/; HttpOnly; SameSite=Strict')
        token,s=self.session()
        if not s: return self.reply(401,{'error':'Сессия завершена. Войдите снова.'})
        if not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf']): return self.reply(403,{'error':'Недопустимый запрос.'})
        if path=='/api/admin/logout':
            SESSIONS.pop(token,None); return self.reply(200,{'ok':True},cookie='slavnaya_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict')
        try:
            if path=='/api/admin/preview':
                updated=validate(data); s['preview']=digest(updated)
                return self.reply(200,{'changes':changes(read_json(DB),updated),'token':s['preview']})
            if path=='/api/admin/prices':
                updated=validate(data)
                if not s.get('preview') or s['preview']!=digest(updated) or data.get('previewToken')!=s['preview']: raise ValueError('Сначала проверьте изменения в предпросмотре.')
                commit(updated); s.pop('preview',None); return self.reply(200,public_data())
            if path=='/api/admin/import':
                return self.reply(200,import_prices(base64.b64decode(data.get('file',''),validate=True),SEED))
            if path=='/api/admin/restore':
                revision=data.get('historyRevision'); old=read_json(DB)
                if revision is not None:
                    source=next((h['data'] for h in old.get('history',[]) if h['data']['revision']==revision),None)
                    if source is None: raise ValueError('Версия не найдена.')
                else: source=data.get('backup')
                if not isinstance(source,dict): raise ValueError('Некорректная резервная копия.')
                clean=validate({**source,'revision':old['revision']}); clean['revision']=old['revision']; return self.reply(200,clean)
            if path=='/api/admin/password':
                now=time.monotonic(); attempts=s.setdefault('password_attempts',[]); attempts[:]=[t for t in attempts if now-t<60]
                if len(attempts)>=5: return self.reply(429,{'error':'Слишком много попыток. Повторите через минуту.'})
                a=read_json(ACCOUNT); current=data.get('current'); new=data.get('new'); confirm=data.get('confirm')
                if not isinstance(current,str) or len(current)>256 or not hmac.compare_digest(derive(current,a['salt']),a['hash']):
                    attempts.append(now); raise ValueError('Неверный текущий пароль.')
                if not isinstance(new,str) or not password_valid(new) or new!=confirm: raise ValueError('Новый пароль: 12–256 символов, подтверждение должно совпадать.')
                salt=secrets.token_hex(16); write_json(ACCOUNT,{'salt':salt,'hash':derive(new,salt)}); SESSIONS.clear()
                return self.reply(200,{'ok':True},cookie='slavnaya_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict')
        except (ValueError,TypeError,AttributeError,KeyError,IndexError,zipfile.BadZipFile,ET.ParseError,binascii.Error) as e:
            return self.reply(400,{'error':str(e) or 'Проверьте формат данных.'})
        return self.reply(404,{'error':'Не найдено'})

if __name__=='__main__':
    init(); server=HTTPServer((HOST,PORT),Handler)
    print(f'Конструктор: {ORIGIN}/\nАдминка: {ORIGIN}/admin/\nОстановить: Ctrl+C. Только локальная проверка.');
    if '--no-browser' not in sys.argv: webbrowser.open(ORIGIN+'/'); webbrowser.open(ORIGIN+'/admin/')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
