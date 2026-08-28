const U="cf5566f2939e84cd62180ed0048052b93776b8697f9904b23388347a1b89adb1",P="8256f6d6c01b59b04fd975975872cac2d0580401d490faca475be8861e261ae1",S="e554fe32c3c49ca8726272a9773410f8b2f5f48e227b1f8c4dafd13326bee785";
const te=new TextEncoder();
async function h(x){let d=await crypto.subtle.digest("SHA-256",te.encode(x));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function sig(x){let k=await crypto.subtle.importKey("raw",te.encode(S),{name:"HMAC",hash:"SHA-256"},false,["sign"]);let d=await crypto.subtle.sign("HMAC",k,te.encode(x));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function page(e=""){return `<!doctype html><html><body style="font-family:Arial;max-width:400px;margin:80px auto"><h2>Central de Conciliação</h2>${e}<form method="post" action="/__auth"><input name="email" placeholder="email"><br><input name="password" type="password" placeholder="senha"><br><button>Entrar</button></form></body></html>`}
export default async (req,ctx)=>{
let p=new URL(req.url).pathname;
if(p=="/__logout"){ctx.cookies.delete({name:"sess",path:"/"});return Response.redirect(new URL("/",req.url),303)}
if(p=="/__auth"){let f=await req.formData();let ok=(await h(String(f.get("email")).toLowerCase()))==U&&(await h(String(f.get("password"))))==P;if(!ok)return new Response(page("Login inválido"),{headers:{"content-type":"text/html"}});let exp=Math.floor(Date.now()/1000)+28800;let t=exp+"."+await sig("c|"+exp);ctx.cookies.set({name:"sess",value:t,httpOnly:true,secure:true,sameSite:"Strict",path:"/",maxAge:28800});return Response.redirect(new URL("/",req.url),303)}
let c=ctx.cookies.get("sess"); if(c){let [e,s]=c.split(".");if(Number(e)>Date.now()/1000&&s==await sig("c|"+e))return ctx.next()}
return new Response(page(),{headers:{"content-type":"text/html"}})
}
