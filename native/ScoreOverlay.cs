using System;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Separate native presentation window. Receives only formatted scoreboard text.
// No browser embedding, page injection, capture, media access or network client.
static class ScoreOverlay {
    static TickerForm Form;
    static readonly object Gate = new object();
    [DllImport("user32.dll")]static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    public static void Update(Rectangle bounds,double opacity,bool clickThrough,string[] lines,string freshness){
        lock(Gate){
            if(Form==null||Form.IsDisposed){
                var ready=new ManualResetEvent(false);Exception failure=null;
                var thread=new Thread(()=>{try{if(SetThreadDpiAwarenessContext(new IntPtr(-4))==IntPtr.Zero)throw new Exception("Overlay DPI initialization failed.");Form=new TickerForm();IntPtr handle=Form.Handle;ready.Set();Application.Run(Form);}catch(Exception e){failure=e;ready.Set();}});
                thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
                if(!ready.WaitOne(5000))throw new Exception("Native ticker initialization timed out.");if(failure!=null)throw failure;
            }
            Form.Invoke(new Action(()=>Form.UpdateTicker(bounds,opacity,clickThrough,lines,freshness)));
        }
    }
    public static void Hide(){lock(Gate){if(Form!=null&&!Form.IsDisposed){var old=Form;old.Invoke(new Action(()=>old.Close()));Form=null;}}}
    class TickerForm:Form {
        string[] Lines=new string[0];string Freshness="";bool Through;int Offset;
        readonly System.Windows.Forms.Timer Paging=new System.Windows.Forms.Timer{Interval=8000};
        public TickerForm(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;Opacity=0;BackColor=Color.FromArgb(12,19,30);DoubleBuffered=true;Text="GameDeck CFB score ticker";StartPosition=FormStartPosition.Manual;Paging.Tick+=(s,e)=>{if(Lines.Length>VisibleCount){Offset=(Offset+VisibleCount)%Lines.Length;Invalidate();}};Paging.Start();}
        protected override bool ShowWithoutActivation{get{return true;}}
        protected override CreateParams CreateParams{get{var cp=base.CreateParams;cp.ExStyle|=0x08000000|0x00000080;if(Through)cp.ExStyle|=0x00000020;return cp;}}
        protected override void WndProc(ref Message message){if(Through&&message.Msg==0x0084){message.Result=new IntPtr(-1);return;}base.WndProc(ref message);}
        int CellWidth{get{return Math.Max(170,(int)Math.Round(Height*3.5));}}
        int BrandWidth{get{return Math.Max(135,(int)Math.Round(Height*2.8));}}
        int VisibleCount{get{return Math.Max(1,(Width-BrandWidth)/CellWidth);}}
        public void UpdateTicker(Rectangle bounds,double opacity,bool through,string[] lines,string freshness){
            if(Through!=through){Through=through;if(IsHandleCreated)RecreateHandle();}
            Bounds=bounds;Opacity=Math.Max(.2,Math.Min(1,opacity));Lines=lines.Take(30).ToArray();Freshness=freshness;Offset=Lines.Length==0?0:Offset%Lines.Length;TopMost=true;if(!Visible)Show();Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e){
            base.OnPaint(e);var g=e.Graphics;g.Clear(BackColor);
            using(var border=new Pen(Color.FromArgb(55,78,111)))g.DrawLine(border,0,0,Width,0);
            using(var font=new Font("Segoe UI",Math.Max(10,Height*.20f),FontStyle.Bold,GraphicsUnit.Pixel))
            using(var small=new Font("Segoe UI",Math.Max(9,Height*.16f),FontStyle.Regular,GraphicsUnit.Pixel))
            using(var title=new SolidBrush(Color.FromArgb(182,209,248)))
            using(var muted=new SolidBrush(Color.FromArgb(112,142,182)))
            using(var text=new SolidBrush(Color.FromArgb(226,235,249)))
            using(var divider=new Pen(Color.FromArgb(43,61,86))){
                g.DrawString("GAMEDECK · CFB",font,title,12,Height*.21f);g.DrawString("Score data · "+Freshness,small,muted,new RectangleF(12,Height*.55f,BrandWidth-20,Height*.4f));
                if(Lines.Length==0){g.DrawString("No selected scores available",font,muted,BrandWidth+15,Height*.35f);return;}
                for(int i=0;i<Math.Min(VisibleCount,Lines.Length);i++){
                    int x=BrandWidth+i*CellWidth;g.DrawLine(divider,x,10,x,Height-10);string[] parts=Lines[(Offset+i)%Lines.Length].Split('\n');
                    g.DrawString(parts[0],font,text,new RectangleF(x+14,Height*.19f,CellWidth-22,Height*.4f));if(parts.Length>1)g.DrawString(parts[1],small,muted,new RectangleF(x+14,Height*.56f,CellWidth-22,Height*.35f));
                }
            }
        }
        protected override void Dispose(bool disposing){if(disposing)Paging.Dispose();base.Dispose(disposing);}
    }
}
