using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

// Optional native-messaging host. Only geometry, style and process identity APIs.
// stdout is reserved exclusively for length-prefixed native-messaging JSON.
class GameDeckHost {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    static readonly Dictionary<string,Lease> Leases = new Dictionary<string,Lease>();
    static int BrowserPid;
    static string Journal, Property = "GameDeck." + Guid.NewGuid().ToString("N");
    static readonly long Cookie = (long)new Random().Next(1,int.MaxValue);
    const int StyleIndex=-16;
    const long FrameMask=0x00C00000L|0x00040000L;
    const uint PlacementFlags=0x0020|0x0010|0x0004|0x0200;
    delegate bool EnumProc(IntPtr hwnd,IntPtr param);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; public int Width {get{return Right-Left;}} public int Height {get{return Bottom-Top;}} }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo {public int Size;public Rect Monitor,Work;public uint Flags;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {public uint Size,Usage,Id;public IntPtr Heap;public uint Module,Threads,Parent;public int Priority;public uint Flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string File;}
    [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr param);
    [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int size);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
    [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]static extern IntPtr GetStyle(IntPtr hwnd,int index);
    [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW",SetLastError=true)]static extern IntPtr SetStyle(IntPtr hwnd,int index,IntPtr style);
    [DllImport("user32.dll",SetLastError=true)]static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
    [DllImport("user32.dll")]static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
    [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool SetProp(IntPtr hwnd,string name,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetProp(IntPtr hwnd,string name);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr RemoveProp(IntPtr hwnd,string name);
    [DllImport("kernel32.dll")]static extern void SetLastError(uint error);
    [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32First(IntPtr snapshot,ref ProcessEntry entry);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool Process32Next(IntPtr snapshot,ref ProcessEntry entry);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
    class Lease {public string Key,Title;public IntPtr Hwnd;public int Pid;public long Start,Style;public Rect Original,NativeMonitor;public Dictionary<string,object> ChromeMonitor;public bool Paired,Modified;public Mutex Lock;}
    static Dictionary<string,object> Obj(object value){var obj=value as Dictionary<string,object>;if(obj==null)throw new Exception("Expected a JSON object.");return obj;}
    static int Num(Dictionary<string,object> obj,string key){if(!obj.ContainsKey(key))throw new Exception("Missing "+key);double n=Convert.ToDouble(obj[key]);if(double.IsNaN(n)||double.IsInfinity(n)||n!=Math.Truncate(n)||Math.Abs(n)>100000)throw new Exception("Invalid coordinate.");return (int)n;}
    static string Text(Dictionary<string,object> obj,string key){object value;return obj.TryGetValue(key,out value)?Convert.ToString(value):"";}
    static Dictionary<string,object> RectObject(Rect r){return new Dictionary<string,object>{{"left",r.Left},{"top",r.Top},{"width",r.Width},{"height",r.Height}};}
    static void ValidateRect(Dictionary<string,object> r){Num(r,"left");Num(r,"top");if(Num(r,"width")<100||Num(r,"height")<100)throw new Exception("Window is too small.");}
    static string WindowText(IntPtr hwnd){var s=new StringBuilder(2048);GetWindowText(hwnd,s,s.Capacity);return s.ToString();}
    static bool ChromeClass(IntPtr hwnd){var s=new StringBuilder(256);GetClassName(hwnd,s,s.Capacity);return s.ToString()=="Chrome_WidgetWin_1";}
    static long ProcessStart(int pid){return Process.GetProcessById(pid).StartTime.ToUniversalTime().Ticks;}
    static bool Identity(Lease lease,bool property){uint pid;GetWindowThreadProcessId(lease.Hwnd,out pid);try{return IsWindow(lease.Hwnd)&&pid==lease.Pid&&ProcessStart(lease.Pid)==lease.Start&&ChromeClass(lease.Hwnd)&&(!property||GetProp(lease.Hwnd,Property).ToInt64()==Cookie);}catch{return false;}}
    static bool TitleMatches(string actual,string expected){return actual==expected||actual==expected+" - Google Chrome"||actual==expected+" — Google Chrome";}
    static Rect Map(Dictionary<string,object> r,Dictionary<string,object> chromeMonitor,Rect monitor){
        ValidateRect(r);ValidateRect(chromeMonitor);
        double sx=(double)monitor.Width/Num(chromeMonitor,"width"),sy=(double)monitor.Height/Num(chromeMonitor,"height");
        if(sx<0.5||sx>4||Math.Abs(sx-sy)>0.02)throw new Exception("Unverified display scaling. Use normal popup mode.");
        Func<string,int> edge=k=>Num(r,k);
        int x=(int)Math.Round(monitor.Left+(edge("left")-Num(chromeMonitor,"left"))*sx),y=(int)Math.Round(monitor.Top+(edge("top")-Num(chromeMonitor,"top"))*sy);
        // Map shared edges, not independent rounded widths, to preserve seams.
        int right=(int)Math.Round(monitor.Left+(edge("left")+edge("width")-Num(chromeMonitor,"left"))*sx),bottom=(int)Math.Round(monitor.Top+(edge("top")+edge("height")-Num(chromeMonitor,"top"))*sy);
        return new Rect{Left=x,Top=y,Right=right,Bottom=bottom};
    }
    static bool Near(Rect a,Rect b,int tolerance){return Math.Abs(a.Left-b.Left)<=tolerance&&Math.Abs(a.Top-b.Top)<=tolerance&&Math.Abs(a.Width-b.Width)<=tolerance&&Math.Abs(a.Height-b.Height)<=tolerance;}
    static Rect Current(IntPtr hwnd){Rect r;if(!GetWindowRect(hwnd,out r))throw new Exception("Window rectangle unavailable.");return r;}
    static void Move(IntPtr hwnd,Rect r){if(!SetWindowPos(hwnd,IntPtr.Zero,r.Left,r.Top,r.Width,r.Height,PlacementFlags))throw new Exception("SetWindowPos failed: "+Marshal.GetLastWin32Error());}
    static void Style(IntPtr hwnd,long value){SetLastError(0);if(SetStyle(hwnd,StyleIndex,new IntPtr(value))==IntPtr.Zero&&Marshal.GetLastWin32Error()!=0)throw new Exception("Could not update native style.");}
    static void SaveJournal(){
        var rows=Leases.Values.Where(l=>l.Modified).Select(l=>new {hwnd=l.Hwnd.ToInt64(),pid=l.Pid,start=l.Start,style=l.Style,rect=RectObject(l.Original),property=Property,cookie=Cookie}).ToArray();
        if(rows.Length==0){if(File.Exists(Journal))File.Delete(Journal);return;}
        File.WriteAllText(Journal,Json.Serialize(new {owner=Process.GetCurrentProcess().Id,ownerStart=ProcessStart(Process.GetCurrentProcess().Id),windows=rows}),Encoding.UTF8);
    }
    static void Restore(string key){
        Lease l;if(!Leases.TryGetValue(key,out l))return;
        if(l.Modified&&Identity(l,true)){Style(l.Hwnd,l.Style);Move(l.Hwnd,l.Original);RemoveProp(l.Hwnd,Property);}
        else if(l.Paired&&Identity(l,true))RemoveProp(l.Hwnd,Property);
        if(l.Lock!=null){l.Lock.ReleaseMutex();l.Lock.Dispose();}
        Leases.Remove(key);SaveJournal();
    }
    static void RestoreAll(){var errors=new List<string>();foreach(string key in Leases.Keys.ToArray())try{Restore(key);}catch(Exception e){errors.Add(e.Message);}if(errors.Count>0)throw new Exception("Restore incomplete; run GameDeckHost.exe --restore after closing this helper. "+String.Join("; ",errors));}
    static object Handle(Dictionary<string,object> message){
        string action=Text(message,"action"),key=Text(message,"key");
        if(action=="hello")return new {version="2.4.0",capability="validated-native-frame-reduction",overlay=true};
        if(action=="restoreAll"){RestoreAll();return new {restored=true};}
        if(action=="restore"){Restore(key);return new {restored=true};}
        if(action=="overlay"){
            if(!message.ContainsKey("enabled")||!Convert.ToBoolean(message["enabled"])){ScoreOverlay.Hide();return new {visible=false};}
            Lease anchor;string anchorKey=Text(message,"anchorKey");
            if(!Leases.TryGetValue(anchorKey,out anchor)||!anchor.Paired||!Identity(anchor,true))throw new Exception("Pair a managed game on the viewing monitor before opening a native overlay.");
            var options=Obj(message["settings"]);Rect area=Map(Obj(message["area"]),Obj(message["monitor"]),anchor.NativeMonitor);
            int logicalHeight=Num(options,"height");if(logicalHeight<40||logicalHeight>160)throw new Exception("Ticker height must be 40–160.");
            double scale=(double)anchor.NativeMonitor.Height/Num(Obj(message["monitor"]),"height");int height=(int)Math.Round(logicalHeight*scale);
            if(area.Left<anchor.NativeMonitor.Left||area.Top<anchor.NativeMonitor.Top||area.Right>anchor.NativeMonitor.Right||area.Bottom>anchor.NativeMonitor.Bottom||height>=area.Height)throw new Exception("Invalid ticker monitor bounds.");
            var lines=((object[])message["lines"]).Select(v=>Convert.ToString(v)).Take(30).Select(v=>v.Length>350?v.Substring(0,350):v).ToArray();
            int top=Text(options,"position")=="top"?area.Top:area.Bottom-height;
            ScoreOverlay.Update(new System.Drawing.Rectangle(area.Left,top,area.Width,height),Convert.ToDouble(options["opacity"]),Convert.ToBoolean(options["clickThrough"]),lines,Text(message,"freshness"));
            return new {visible=true};
        }
        if(key.Length<1||key.Length>100)throw new Exception("Invalid game key.");
        if(action=="prepare"){
            if(Leases.ContainsKey(key))throw new Exception("Window is already paired.");
            var rect=Obj(message["rect"]);var monitor=Obj(message["monitor"]);ValidateRect(rect);ValidateRect(monitor);
            string title=Text(message,"title");if(title.Length<1||title.Length>2000)throw new Exception("A current tab title is required.");
            var candidates=new List<Lease>();
            EnumWindows((hwnd,param)=>{uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid!=BrowserPid||!IsWindowVisible(hwnd)||!ChromeClass(hwnd)||!TitleMatches(WindowText(hwnd),title))return true;
                try{var mi=new MonitorInfo{Size=Marshal.SizeOf(typeof(MonitorInfo))};if(!GetMonitorInfo(MonitorFromWindow(hwnd,2),ref mi))return true;Rect actual=Current(hwnd);if(Near(actual,Map(rect,monitor,mi.Monitor),24))candidates.Add(new Lease{Key=key,Hwnd=hwnd,Pid=(int)pid,Start=ProcessStart((int)pid),Style=GetStyle(hwnd,StyleIndex).ToInt64(),Original=actual,NativeMonitor=mi.Monitor,ChromeMonitor=monitor,Title=title});}catch{}return true;},IntPtr.Zero);
            if(candidates.Count!=1)throw new Exception("Could not uniquely validate this Chrome popup and its DPI mapping. No native windows were modified.");
            Leases[key]=candidates[0];return new {challengeRequired=true};
        }
        Lease lease;if(!Leases.TryGetValue(key,out lease)||!Identity(lease,lease.Paired))throw new Exception("Paired Chrome window no longer exists or changed identity.");
        if(action=="pair"){
            if(lease.Paired)throw new Exception("Already paired.");
            Rect observed=Current(lease.Hwnd),expected=Map(Obj(message["rect"]),lease.ChromeMonitor,lease.NativeMonitor);
            int dx=observed.Left-lease.Original.Left;
            if(Math.Abs(dx)<8||!Near(observed,expected,3)||!TitleMatches(WindowText(lease.Hwnd),lease.Title))throw new Exception("Chrome geometry challenge failed. Native styles were not changed.");
            lease.Lock=new Mutex(false,"Local\\GameDeck.Window."+lease.Pid+"."+lease.Hwnd.ToInt64());
            if(!lease.Lock.WaitOne(0)){lease.Lock.Dispose();lease.Lock=null;throw new Exception("Another helper already manages this window.");}
            if(!SetProp(lease.Hwnd,Property,new IntPtr(Cookie)))throw new Exception("Could not mark validated window identity.");
            lease.Paired=true;return new {paired=true};
        }
        if(action=="place"){
            if(!lease.Paired)throw new Exception("Complete the geometry challenge first.");
            Rect target=Map(Obj(message["rect"]),Obj(message["monitor"]),lease.NativeMonitor);
            if(target.Left<lease.NativeMonitor.Left||target.Top<lease.NativeMonitor.Top||target.Right>lease.NativeMonitor.Right||target.Bottom>lease.NativeMonitor.Bottom)throw new Exception("Native target leaves the validated monitor. Exit immersive mode before changing monitors.");
            lease.Modified=true;SaveJournal(); // Journal original style before the first mutation.
            Style(lease.Hwnd,lease.Style&~FrameMask);Move(lease.Hwnd,target);
            Rect actual=Current(lease.Hwnd);
            return new {placed=true,actual=RectObject(actual),adjusted=!Near(actual,target,0),note="Chrome custom-drawn decorations may remain."};
        }
        throw new Exception("Unsupported native command.");
    }
    static int Parent(int id){IntPtr snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot.ToInt64()==-1)return 0;try{var e=new ProcessEntry{Size=(uint)Marshal.SizeOf(typeof(ProcessEntry))};if(Process32First(snapshot,ref e))do{if(e.Id==id)return (int)e.Parent;}while(Process32Next(snapshot,ref e));return 0;}finally{CloseHandle(snapshot);}}
    static int ChromeAncestor(){int id=Process.GetCurrentProcess().Id;for(int n=0;n<8;n++){id=Parent(id);if(id<=0)break;try{var p=Process.GetProcessById(id);if(p.ProcessName=="chrome"&&FileVersionInfo.GetVersionInfo(p.MainModule.FileName).ProductName=="Google Chrome")return id;}catch{}}throw new Exception("Native host must be launched by Google Chrome.");}
    static byte[] ReadFrame(Stream stream){byte[] prefix=new byte[4];if(stream.Read(prefix,0,1)==0)return null;ReadExact(stream,prefix,1,3);int length=BitConverter.ToInt32(prefix,0);if(length<2||length>65536)throw new Exception("Invalid native message length.");byte[] payload=new byte[length];ReadExact(stream,payload,0,length);return payload;}
    static void ReadExact(Stream stream,byte[] data,int offset,int length){while(length>0){int n=stream.Read(data,offset,length);if(n==0)throw new EndOfStreamException();offset+=n;length-=n;}}
    static void WriteFrame(Stream stream,object message){byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(message));byte[] prefix=BitConverter.GetBytes(bytes.Length);stream.Write(prefix,0,4);stream.Write(bytes,0,bytes.Length);stream.Flush();}
    static void Recovery(string folder){
        foreach(string file in Directory.Exists(folder)?Directory.GetFiles(folder,"native-session-*.json"):new string[0]){
            var journal=Obj(Json.DeserializeObject(File.ReadAllText(file)));int owner=Convert.ToInt32(journal["owner"]);try{if(ProcessStart(owner)==Convert.ToInt64(journal["ownerStart"]))continue;}catch{}
            foreach(object row in (object[])journal["windows"]){var r=Obj(row);IntPtr hwnd=new IntPtr(Convert.ToInt64(r["hwnd"]));uint pid;GetWindowThreadProcessId(hwnd,out pid);if(!IsWindow(hwnd)||!ChromeClass(hwnd)||pid!=Convert.ToInt32(r["pid"]))continue;try{if(ProcessStart((int)pid)!=Convert.ToInt64(r["start"]))continue;}catch{continue;}
                string prop=Text(r,"property");if(!prop.StartsWith("GameDeck.")||GetProp(hwnd,prop).ToInt64()!=Convert.ToInt64(r["cookie"]))continue;
                var rect=Obj(r["rect"]);Style(hwnd,Convert.ToInt64(r["style"]));Move(hwnd,new Rect{Left=Num(rect,"left"),Top=Num(rect,"top"),Right=Num(rect,"left")+Num(rect,"width"),Bottom=Num(rect,"top")+Num(rect,"height")});RemoveProp(hwnd,prop);
            }File.Delete(file);
        }
    }
    static void SelfTest(){
        var m=new Dictionary<string,object>{{"left",-1920},{"top",0},{"width",1920},{"height",1032}};
        var r=new Dictionary<string,object>{{"left",-1920},{"top",0},{"width",1248},{"height",1032}};
        Rect mapped=Map(r,m,new Rect{Left=-2880,Top=0,Right=0,Bottom=1548});if(mapped.Left!=-2880||mapped.Width!=1872||mapped.Height!=1548)throw new Exception("DPI mapping failed.");
        var ms=new MemoryStream();WriteFrame(ms,new {action="hello"});ms.Position=0;if(ReadFrame(ms)==null)throw new Exception("Framing failed.");
        bool rejected=false;try{ReadFrame(new MemoryStream(new byte[]{255,255,255,127}));}catch{rejected=true;}if(!rejected)throw new Exception("Oversize frame accepted.");
        if(TitleMatches("Other game","Game")||!TitleMatches("Game - Google Chrome","Game"))throw new Exception("Title matching failed.");
        Console.WriteLine("PASS: DPI edge mapping, native-message framing, message limits, title validation. No windows modified.");
    }
    public static int Main(string[] args){
        try{
            if(args.Contains("--self-test")){SelfTest();return 0;}
            if(SetThreadDpiAwarenessContext(new IntPtr(-4))==IntPtr.Zero)throw new Exception("Could not establish per-monitor native DPI awareness. No windows modified.");
            string folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"GameDeck");
            if(args.Contains("--restore")){Recovery(folder);return 0;}
            if(args.Length<1||!System.Text.RegularExpressions.Regex.IsMatch(args[0],"^chrome-extension://[a-p]{32}/$"))throw new Exception("Invalid Chrome extension origin.");
            BrowserPid=ChromeAncestor();Directory.CreateDirectory(folder);Journal=Path.Combine(folder,"native-session-"+Guid.NewGuid().ToString("N")+".json");
            Stream input=Console.OpenStandardInput(),output=Console.OpenStandardOutput();byte[] payload;
            while((payload=ReadFrame(input))!=null){int id=0;try{var message=Obj(Json.DeserializeObject(Encoding.UTF8.GetString(payload)));id=Convert.ToInt32(message["id"]);var data=Handle(message);WriteFrame(output,new {id=id,ok=true,data=data});}catch(Exception e){WriteFrame(output,new {id=id,ok=false,error=e.Message});}}
            return 0;
        }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}
        finally{try{ScoreOverlay.Hide();if(Journal!=null)RestoreAll();}catch(Exception e){Console.Error.WriteLine(e.Message);}}
    }
}
