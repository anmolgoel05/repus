type DownloadAnchor=HTMLAnchorElement;

export type BrowserDownloadEnvironment={
 createObjectURL:(blob:Blob)=>string;
 revokeObjectURL:(url:string)=>void;
 createAnchor:()=>DownloadAnchor;
 appendAnchor:(anchor:DownloadAnchor)=>void;
 defer:(callback:()=>void,milliseconds:number)=>unknown;
};

export function triggerBlobDownload(blob:Blob,filename:string,environment:BrowserDownloadEnvironment={
 createObjectURL:value=>URL.createObjectURL(value),
 revokeObjectURL:url=>URL.revokeObjectURL(url),
 createAnchor:()=>document.createElement('a'),
 appendAnchor:anchor=>document.body.append(anchor),
 defer:(callback,milliseconds)=>window.setTimeout(callback,milliseconds),
}){
 const url=environment.createObjectURL(blob);
 const anchor=environment.createAnchor();
 anchor.href=url;
 anchor.download=filename;
 environment.appendAnchor(anchor);
 anchor.click();
 environment.defer(()=>{
  anchor.remove();
  environment.revokeObjectURL(url);
 },1000);
}
