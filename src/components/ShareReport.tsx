import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Share2, 
  FileText, 
  FileSpreadsheet, 
  Link2, 
  Mail, 
  Check,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { PredictionData } from "@/pages/Dashboard";

interface ShareReportProps {
  data: PredictionData;
}

export const ShareReport = ({ data }: ShareReportProps) => {
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  const generateCSV = () => {
    const headers = ["Date", "Price", "Type"];
    const rows = data.historicalData.map(d => [d.date, d.price.toString(), "Historical"]);
    rows.push([data.targetDate, data.predictedPrice.toString(), "Predicted"]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const metadata = `\n\nPrediction Summary\nTicker,${data.ticker}\nTarget Date,${data.targetDate}\nCurrent Price,$${data.currentPrice.toFixed(2)}\nPredicted Price,$${data.predictedPrice.toFixed(2)}\nConfidence,${data.confidence.toFixed(1)}%\nRegime,${data.regime}`;

    return csvContent + metadata;
  };

  const handleExportCSV = async () => {
    setIsExporting("csv");
    try {
      const csv = generateCSV();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.ticker}_stockai_${data.targetDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV exported");
    } catch (error) {
      toast.error("Export failed");
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting("pdf");
    try {
      const esc = (s: unknown) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const reportHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${esc(data.ticker)} - StockAI Report</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
              padding: 48px; 
              background: #0a0a0a; 
              color: #fafafa;
              min-height: 100vh;
            }
            .header { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              margin-bottom: 40px;
              padding-bottom: 20px;
              border-bottom: 1px solid #262626;
            }
            .logo { font-size: 24px; font-weight: 500; }
            .logo span { color: #5a8a6a; }
            .badge { 
              background: #1a2a1f; 
              color: #5a8a6a; 
              padding: 6px 12px; 
              border-radius: 4px; 
              font-size: 12px;
              text-transform: capitalize;
            }
            .ticker { font-size: 48px; font-weight: 600; margin-bottom: 8px; font-family: monospace; }
            .ticker span { color: #5a8a6a; }
            .date { color: #737373; font-size: 14px; margin-bottom: 40px; }
            .stats { 
              display: grid; 
              grid-template-columns: repeat(4, 1fr); 
              gap: 20px; 
              margin-bottom: 40px;
            }
            .stat { 
              background: #141414; 
              padding: 20px; 
              border-radius: 8px;
              border: 1px solid #262626;
            }
            .stat-label { font-size: 11px; color: #737373; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
            .stat-value { font-size: 24px; font-weight: 500; font-family: monospace; }
            .stat-value.positive { color: #5a8a6a; }
            .stat-value.negative { color: #ef4444; }
            .reasoning { 
              background: #141414; 
              padding: 24px; 
              border-radius: 8px; 
              margin-bottom: 40px;
              border: 1px solid #262626;
            }
            .reasoning-title { font-size: 12px; color: #737373; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
            .reasoning-text { font-size: 14px; line-height: 1.7; color: #a3a3a3; }
            .disclaimer { 
              background: #1a1a0f; 
              border: 1px solid #3d3d00; 
              padding: 16px; 
              border-radius: 8px; 
              font-size: 11px; 
              color: #a3a3a3;
              margin-top: 40px;
            }
            .footer { 
              margin-top: 40px; 
              padding-top: 20px; 
              border-top: 1px solid #262626; 
              font-size: 11px; 
              color: #525252;
              display: flex;
              justify-content: space-between;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">Stock<span>AI</span></div>
            <span class="badge">${esc(data.regime)}</span>
          </div>
          
          <div class="ticker">${esc(data.ticker)}</div>
          <div class="date">Target: ${esc(data.targetDate)}</div>
          
          <div class="stats">
            <div class="stat">
              <div class="stat-label">Current Price</div>
              <div class="stat-value">$${data.currentPrice.toFixed(2)}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Predicted Price</div>
              <div class="stat-value ${data.predictedPrice >= data.currentPrice ? 'positive' : 'negative'}">$${data.predictedPrice.toFixed(2)}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Confidence</div>
              <div class="stat-value">${data.confidence.toFixed(0)}%</div>
            </div>
            <div class="stat">
              <div class="stat-label">Range</div>
              <div class="stat-value" style="font-size: 16px;">$${data.uncertaintyLow.toFixed(2)} - $${data.uncertaintyHigh.toFixed(2)}</div>
            </div>
          </div>

          ${data.reasoning ? `
          <div class="reasoning">
            <div class="reasoning-title">AI Analysis</div>
            <div class="reasoning-text">${esc(data.reasoning)}</div>
          </div>
          ` : ''}

          <div class="disclaimer">
            ⚠️ This is AI-generated analysis for informational purposes only. Not financial advice. Do not use for actual trading decisions.
          </div>

          <div class="footer">
            <span>Generated by StockAI</span>
            <span>${new Date().toLocaleDateString()}</span>
          </div>
        </body>
        </html>
      `;
      
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(reportHtml);
        printWindow.document.close();
        printWindow.print();
        toast.success("PDF ready - use print dialog to save");
      }
    } catch (error) {
      toast.error("Export failed");
    } finally {
      setIsExporting(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      const shareData = {
        ticker: data.ticker,
        targetDate: data.targetDate,
        predictedPrice: data.predictedPrice,
        confidence: data.confidence,
        regime: data.regime,
      };
      const encodedData = btoa(JSON.stringify(shareData));
      const shareUrl = `${window.location.origin}/dashboard?share=${encodedData}`;
      
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      toast.success("Link copied");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Copy failed");
    }
  };

  const handleEmailReport = () => {
    if (!email) {
      toast.error("Enter an email address");
      return;
    }
    
    const subject = encodeURIComponent(`${data.ticker} StockAI Report - ${data.targetDate}`);
    const body = encodeURIComponent(`
${data.ticker} Stock Prediction
=====================================

Target Date: ${data.targetDate}
Current Price: $${data.currentPrice.toFixed(2)}
Predicted Price: $${data.predictedPrice.toFixed(2)}
Change: ${((data.predictedPrice - data.currentPrice) / data.currentPrice * 100).toFixed(2)}%

Confidence: ${data.confidence.toFixed(1)}%
Market Regime: ${data.regime}

---
Generated by StockAI
Not financial advice.
    `);
    
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
    setIsEmailDialogOpen(false);
    setEmail("");
    toast.success("Email client opened");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={handleExportPDF} disabled={isExporting === "pdf"}>
            {isExporting === "pdf" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            Export PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportCSV} disabled={isExporting === "csv"}>
            {isExporting === "csv" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            Export CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyLink}>
            {isCopied ? (
              <Check className="w-4 h-4 mr-2 text-success" />
            ) : (
              <Link2 className="w-4 h-4 mr-2" />
            )}
            {isCopied ? "Copied" : "Copy Link"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsEmailDialogOpen(true)}>
            <Mail className="w-4 h-4 mr-2" />
            Email Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Report</DialogTitle>
            <DialogDescription>
              Send prediction report to an email address
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="recipient@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsEmailDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEmailReport}>
                <Mail className="w-4 h-4 mr-2" />
                Send
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};