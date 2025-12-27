import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Copy, 
  Check,
  Download,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { PredictionData } from "./PredictionResult";

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

    const metadata = `\n\nPrediction Summary\nTicker,${data.ticker}\nTarget Date,${data.targetDate}\nCurrent Price,$${data.currentPrice.toFixed(2)}\nPredicted Price,$${data.predictedPrice.toFixed(2)}\nUncertainty Range,$${data.uncertaintyLow.toFixed(2)} - $${data.uncertaintyHigh.toFixed(2)}\nConfidence,${data.confidence.toFixed(1)}%\nRegime,${data.regime}\nSentiment Score,${data.sentimentScore.toFixed(2)}\n\nFeature Importance\n${data.featureImportance.map(f => `${f.name},${(f.importance * 100).toFixed(1)}%`).join("\n")}`;

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
      a.download = `${data.ticker}_prediction_${data.targetDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("CSV exported successfully");
    } catch (error) {
      toast.error("Failed to export CSV");
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting("pdf");
    try {
      // Generate a simple HTML report and trigger print dialog
      const reportHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${data.ticker} Prediction Report</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; padding: 40px; background: #fff; color: #333; }
            h1 { color: #2d5a4a; border-bottom: 2px solid #5a8a7a; padding-bottom: 10px; }
            .header { display: flex; justify-content: space-between; align-items: center; }
            .badge { background: #5a8a7a; color: white; padding: 4px 12px; border-radius: 4px; font-size: 14px; }
            .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0; }
            .stat-card { background: #f5f5f5; padding: 20px; border-radius: 8px; border-left: 4px solid #5a8a7a; }
            .stat-label { font-size: 12px; color: #666; margin-bottom: 5px; }
            .stat-value { font-size: 24px; font-weight: bold; color: #333; }
            .feature-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            .feature-table th, .feature-table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
            .feature-table th { background: #f0f0f0; }
            .bar { height: 8px; background: #5a8a7a; border-radius: 4px; }
            .disclaimer { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin-top: 30px; font-size: 12px; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${data.ticker} Stock Prediction Report</h1>
            <span class="badge">${data.regime.charAt(0).toUpperCase() + data.regime.slice(1)}</span>
          </div>
          <p>Target Date: ${data.targetDate} | Generated: ${new Date().toLocaleDateString()}</p>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-label">Predicted Price</div>
              <div class="stat-value">$${data.predictedPrice.toFixed(2)}</div>
              <div style="color: ${data.predictedPrice >= data.currentPrice ? '#22c55e' : '#ef4444'}">
                ${data.predictedPrice >= data.currentPrice ? '↑' : '↓'} ${((data.predictedPrice - data.currentPrice) / data.currentPrice * 100).toFixed(2)}%
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Uncertainty Range</div>
              <div class="stat-value">$${data.uncertaintyLow.toFixed(2)} - $${data.uncertaintyHigh.toFixed(2)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Model Confidence</div>
              <div class="stat-value">${data.confidence.toFixed(1)}%</div>
            </div>
          </div>

          <h2>Feature Importance</h2>
          <table class="feature-table">
            <tr><th>Feature</th><th>Importance</th><th></th></tr>
            ${data.featureImportance.map(f => `
              <tr>
                <td>${f.name}</td>
                <td>${(f.importance * 100).toFixed(1)}%</td>
                <td style="width: 200px"><div class="bar" style="width: ${f.importance * 100 * 3}%"></div></td>
              </tr>
            `).join('')}
          </table>

          <div class="disclaimer">
            <strong>⚠️ Disclaimer:</strong> This is a simulated prediction for demonstration purposes only. Do not use for actual trading decisions. Past performance does not guarantee future results.
          </div>

          <div class="footer">
            Generated by GodStockAI | Sentiment Score: ${data.sentimentScore.toFixed(2)}
          </div>
        </body>
        </html>
      `;
      
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(reportHtml);
        printWindow.document.close();
        printWindow.print();
        toast.success("PDF export ready - use print dialog to save");
      }
    } catch (error) {
      toast.error("Failed to export PDF");
    } finally {
      setIsExporting(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      // Generate a shareable link with encoded data
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
      toast.success("Link copied to clipboard");
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy link");
    }
  };

  const handleEmailReport = () => {
    if (!email) {
      toast.error("Please enter an email address");
      return;
    }
    
    const subject = encodeURIComponent(`${data.ticker} Stock Prediction Report - ${data.targetDate}`);
    const body = encodeURIComponent(`
${data.ticker} Stock Prediction Report
=====================================

Target Date: ${data.targetDate}
Current Price: $${data.currentPrice.toFixed(2)}
Predicted Price: $${data.predictedPrice.toFixed(2)}
Change: ${((data.predictedPrice - data.currentPrice) / data.currentPrice * 100).toFixed(2)}%

Uncertainty Range: $${data.uncertaintyLow.toFixed(2)} - $${data.uncertaintyHigh.toFixed(2)}
Model Confidence: ${data.confidence.toFixed(1)}%
Market Regime: ${data.regime}
Sentiment Score: ${data.sentimentScore.toFixed(2)}

Top Features:
${data.featureImportance.slice(0, 3).map(f => `- ${f.name}: ${(f.importance * 100).toFixed(1)}%`).join('\n')}

---
Generated by GodStockAI
Disclaimer: This is for educational purposes only.
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
            Share Report
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={handleExportPDF} disabled={isExporting === "pdf"}>
            {isExporting === "pdf" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            Export as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExportCSV} disabled={isExporting === "csv"}>
            {isExporting === "csv" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCopyLink}>
            {isCopied ? (
              <Check className="w-4 h-4 mr-2 text-success" />
            ) : (
              <Link2 className="w-4 h-4 mr-2" />
            )}
            {isCopied ? "Copied!" : "Copy Link"}
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
              Enter an email address to send the prediction report
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
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
                Send Email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};