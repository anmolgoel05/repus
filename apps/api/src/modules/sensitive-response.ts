export type SensitiveResponse={setHeader:(name:string,value:string)=>unknown};

export function setSensitiveResponseHeaders(response:SensitiveResponse){
 response.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
 response.setHeader('Pragma','no-cache');
 response.setHeader('Expires','0');
 response.setHeader('Referrer-Policy','no-referrer');
 response.setHeader('X-Content-Type-Options','nosniff');
}
