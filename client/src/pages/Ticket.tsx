import { useState } from "react";
import { ArrowLeft, QrCode, Download, Share2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useParking, VehicleType } from "@/lib/parking-context";
import { useToast } from "@/hooks/use-toast";

export default function Ticket() {
  const { enterVehicle } = useParking();
  const { toast } = useToast();

  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("light");
  const [ticket, setTicket] = useState<any | null>(null);

  /* ================= GENERATE TICKET ================= */

  const handleGenerateTicket = async () => {
    if (!vehicleNumber.trim()) {
      toast({
        variant: "destructive",
        title: "Vehicle number required",
        description: "Please enter a valid vehicle number",
      });
      return;
    }

    const result = await enterVehicle(vehicleNumber, vehicleType);

    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Entry failed",
        description: result.message || "Unable to park vehicle",
      });
      return;
    }

    setTicket({
      id: result.ticket?.ticketId,
      vehicle: result.ticket?.vehicleNumber,
      zone: result.ticket?.zoneName,
      slot: result.ticket?.slot || "Auto Assigned",
      entryTime: result.ticket?.time,
      date: new Date().toLocaleDateString(),
    });

    toast({
      title: "Ticket generated",
      description: `Vehicle parked in ${result.ticket?.zoneName}`,
    });

    setVehicleNumber("");
  };

  /* ================= UI ================= */

  return (
    <div className="min-h-screen bg-muted/30 p-4 flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Generate Ticket</h1>
      </div>

      {!ticket ? (
        /* ================= ENTRY FORM ================= */
        <div className="max-w-sm mx-auto space-y-4">
          <Input
            placeholder="Vehicle Number (eg: KL-01-AB-1234)"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
          />

          <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as VehicleType)}>
            <SelectTrigger>
              <SelectValue placeholder="Vehicle Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="heavy">Heavy</SelectItem>
            </SelectContent>
          </Select>

          <Button className="w-full" onClick={handleGenerateTicket}>
            Generate Ticket
          </Button>
        </div>
      ) : (
        /* ================= TICKET VIEW ================= */
        <div className="flex-1 flex items-center justify-center pb-12">
          <Card className="w-full max-w-sm shadow-xl border-0 overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-2 bg-primary" />

            <CardContent className="pt-8 pb-8 px-6 text-center space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-primary">Nilakkal Parking</h2>
                <p className="text-xs text-muted-foreground uppercase tracking-widest">
                  Official Parking Receipt
                </p>
              </div>

              <div className="py-6 bg-muted/20 rounded-lg border">
                <div className="text-3xl font-black">{ticket.slot}</div>
                <p className="text-sm text-muted-foreground">Assigned Slot</p>
              </div>

              <div className="grid grid-cols-2 gap-y-4 text-sm text-left">
                <div>
                  <p className="text-xs text-muted-foreground">Zone</p>
                  <p className="font-semibold">{ticket.zone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Vehicle</p>
                  <p className="font-mono font-semibold">{ticket.vehicle}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-semibold">{ticket.date}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Entry Time</p>
                  <p className="font-semibold">{ticket.entryTime}</p>
                </div>
              </div>

              <Separator />

              <div className="flex flex-col items-center space-y-4">
                <div className="bg-white p-4 rounded-xl border">
                  <QrCode className="w-28 h-28" />
                </div>
                <p className="font-mono text-xs text-muted-foreground">{ticket.id}</p>
              </div>
            </CardContent>

            <div className="grid grid-cols-2 border-t divide-x">
              <Button variant="ghost" className="rounded-none h-12">
                <Download className="w-4 h-4 mr-2" /> Save
              </Button>
              <Button variant="ghost" className="rounded-none h-12">
                <Share2 className="w-4 h-4 mr-2" /> Share
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
