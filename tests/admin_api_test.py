"""Run from project root: python tests/admin_api_test.py (isolated temporary data)."""
import http.cookiejar as http_cookiejar
import sys, tempfile, threading, json, base64, urllib.request, urllib.error, http.cookiejar
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server as s
with tempfile.TemporaryDirectory() as tmp:
    s.DB=Path(tmp)/'pricing.json'; s.ACCOUNT=Path(tmp)/'account.json'
    pw='Testing-password-123'; salt='0a'*16
    s.write_json(s.ACCOUNT,{'salt':salt,'hash':s.derive(pw,salt)}); s.init()
    http=s.HTTPServer((s.HOST,0),s.Handler); s.PORT=http.server_port;s.ORIGIN=f'http://{s.HOST}:{s.PORT}'
    threading.Thread(target=http.serve_forever,daemon=True).start()
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http_cookiejar.CookieJar()))
    csrf=''; checks=0
    def req(path,body=None,expected=200,raw=False,origin=None,token=None):
        global checks
        h={'Origin':s.ORIGIN if origin is None else origin,'Content-Type':'application/json','X-CSRF-Token':csrf if token is None else token}
        q=urllib.request.Request(s.ORIGIN+path,data=None if body is None else json.dumps(body).encode(),headers=h)
        try:r=client.open(q)
        except urllib.error.HTTPError as e:r=e
        assert r.status==expected,(path,r.status,r.read());checks+=1
        b=r.read();return b if raw else json.loads(b)
    for path in ('prices','export','backup','history'):req('/api/admin/'+path,expected=401)
    req('/api/admin/preview',{},401)
    req('/api/admin/login',{'login':'admin','password':pw},origin='https://other.example',expected=403)
    req('/api/admin/login',{'login':'admin','password':pw})
    a=req('/api/admin/prices');csrf=a['csrf'];p={k:a[k] for k in ('revision','prices','worktops','promo')};p['prices']['1.1.4']=3000;p['promo'].update(enabled=True,target='article',scope='1.1.4',percent=15)
    req('/api/admin/prices',p,400);req('/api/admin/preview',p,403,token='bad')
    preview=req('/api/admin/preview',p);assert len(preview['changes'])>=3
    assert req('/api/prices')['prices']['1.1.4']==2860
    p['previewToken']=preview['token'];bad={**p,'prices':{**p['prices'],'1.1.4':3001}};req('/api/admin/prices',bad,400)
    result=req('/api/admin/prices',p);assert result['prices']['1.1.4']==3000 and result['promo']['active'] and 'history' not in result
    req('/api/admin/prices',p,400)
    exported=req('/api/admin/export',raw=True); parsed=req('/api/admin/import',{'file':base64.b64encode(exported).decode()});assert parsed['prices']['1.1.4']==3000 and len(parsed['prices'])==17
    req('/api/admin/import',{'file':'bm90IHhsc3g='},400)
    backup=req('/api/admin/backup'); assert 'hash' not in backup and 'history' not in backup
    h=req('/api/admin/history');assert h['entries'][0]['revision']==1
    restore=req('/api/admin/restore',{'historyRevision':1});assert restore['prices']['1.1.4']==2860 and req('/api/prices')['prices']['1.1.4']==3000
    restore['previewToken']=req('/api/admin/preview',restore)['token'];req('/api/admin/prices',restore);assert req('/api/prices')['prices']['1.1.4']==2860
    assert req('/api/admin/restore',{'backup':backup})['prices']['1.1.4']==3000
    req('/api/admin/password',{'current':'bad','new':'Testing-password-456','confirm':'Testing-password-456'},400)
    req('/api/admin/password',{'current':pw,'new':'Testing-password-456','confirm':'Testing-password-456'});req('/api/admin/history',expected=401)
    req('/api/admin/login',{'login':'admin','password':pw},401);req('/api/admin/login',{'login':'admin','password':'Testing-password-456'})
    assert s.read_json(s.DB)['revision']==3
    http.shutdown();http.server_close();print(f'{checks} HTTP checks passed')
