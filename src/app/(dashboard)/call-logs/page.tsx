"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Loader2, Calendar as CalendarIcon, Edit2, Trash2, ShieldAlert } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "CUSTOM">("ALL");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Edit / Delete states
  const [editingLog, setEditingLog] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({ 
    employeeName: "", 
    contactName: "", 
    phoneNumber: "", 
    callType: "INCOMING", 
    duration: 0, 
    timestamp: "" 
  });
  const [isUpdating, setIsUpdating] = useState(false);
  
  const [deletingLog, setDeletingLog] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [typeFilter, dateFilter, dateRange]);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const url = new URL("/api/call-logs", window.location.origin);
      if (typeFilter !== "ALL") url.searchParams.append("callType", typeFilter);
      
      let start: Date | null = null;
      let end: Date | null = null;
      
      if (dateFilter === "TODAY") {
        start = startOfDay(new Date());
        end = endOfDay(new Date());
      } else if (dateFilter === "YESTERDAY") {
        const yesterday = subDays(new Date(), 1);
        start = startOfDay(yesterday);
        end = endOfDay(yesterday);
      } else if (dateFilter === "CUSTOM" && dateRange?.from) {
        start = startOfDay(dateRange.from);
        end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      }
      
      if (start) url.searchParams.append("startDate", start.toISOString());
      if (end) url.searchParams.append("endDate", end.toISOString());
      
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch call logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => 
    searchQuery === "" || log.phoneNumber.includes(searchQuery)
  );

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const openEditModal = (log: any) => {
    setEditingLog(log);
    setEditFormData({ 
      employeeName: log.employeeName || log.driverId?.userId?.name || "", 
      contactName: log.contactName || "", 
      phoneNumber: log.phoneNumber || "", 
      callType: log.callType || "INCOMING", 
      duration: log.duration || 0,
      timestamp: log.timestamp ? new Date(log.timestamp).toISOString().slice(0, 16) : "" // For datetime-local input
    });
  };

  const updateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    try {
      const res = await fetch("/api/call-logs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _id: editingLog._id,
          ...editFormData,
          timestamp: new Date(editFormData.timestamp).toISOString()
        }),
      });
      if (res.ok) {
        setEditingLog(null);
        fetchLogs();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update call log");
      }
    } catch (error) {
      console.error(error);
      alert("An error occurred while updating.");
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteLog = async () => {
    if (!deletingLog) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/call-logs?id=${deletingLog._id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setDeletingLog(null);
        fetchLogs();
      } else {
         const data = await res.json();
         alert(data.error || "Failed to delete call log");
      }
    } catch (error) {
       console.error(error);
       alert("An error occurred while deleting.");
    } finally {
       setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">Call Logs</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-4 relative z-10">
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-slate-400">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
        <div className="p-4 border-b border-slate-800 flex flex-col xl:flex-row gap-4 xl:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-950 border-slate-700 text-white"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
              {["ALL", "INCOMING", "OUTGOING", "MISSED"].map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    typeFilter === type 
                      ? "bg-indigo-600 text-white" 
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex gap-2 w-full xl:w-auto overflow-x-auto items-center pb-2 xl:pb-0">
            {["ALL", "TODAY", "YESTERDAY"].map((df) => (
              <button
                key={df}
                onClick={() => setDateFilter(df as any)}
                className={cn(
                  "px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                  dateFilter === df && dateFilter !== "CUSTOM"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                )}
              >
                {df === "ALL" ? "All Time" : df === "TODAY" ? "Today" : "Yesterday"}
              </button>
            ))}
            
            <Popover>
              <PopoverTrigger asChild>
                <button
                  onClick={() => setDateFilter("CUSTOM")}
                  className={cn(
                    "flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-w-[140px]",
                    dateFilter === "CUSTOM"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  )}
                >
                  <CalendarIcon className="w-3 h-3" />
                  {dateFilter === "CUSTOM" && dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    "Custom Date"
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-slate-800 bg-slate-950" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={(range) => {
                    setDateRange(range);
                    if (range?.from) setDateFilter("CUSTOM");
                  }}
                  numberOfMonths={2}
                  className="text-white bg-slate-950 border-slate-800"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400">Employee</TableHead>
              <TableHead className="text-slate-400">Contact</TableHead>
              <TableHead className="text-slate-400">Phone Number</TableHead>
              <TableHead className="text-slate-400">Type</TableHead>
              <TableHead className="text-slate-400">Duration</TableHead>
              <TableHead className="text-slate-400">Date & Time</TableHead>
              <TableHead className="text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                  No call logs found.
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log: any) => (
                <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/50 group">
                  <TableCell className="font-medium text-slate-300">
                    {log.employeeName || log.driverId?.userId?.name || "Unknown Employee"}
                  </TableCell>
                  <TableCell className="text-slate-400">
                    {log.contactName || "Unknown"}
                  </TableCell>
                  <TableCell>{log.phoneNumber}</TableCell>
                  <TableCell>
                    {log.callType === "INCOMING" && <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20"><PhoneIncoming className="w-3 h-3 mr-1" /> Incoming</Badge>}
                    {log.callType === "OUTGOING" && <Badge className="bg-sky-500/10 text-sky-500 hover:bg-sky-500/20 border-sky-500/20"><PhoneOutgoing className="w-3 h-3 mr-1" /> Outgoing</Badge>}
                    {log.callType === "MISSED" && <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20"><PhoneMissed className="w-3 h-3 mr-1" /> Missed</Badge>}
                  </TableCell>
                  <TableCell className="text-slate-400">{formatDuration(log.duration)}</TableCell>
                  <TableCell className="text-slate-400">
                    {log.timestamp && !isNaN(new Date(log.timestamp).getTime()) 
                      ? format(new Date(log.timestamp), "MMM dd, yyyy HH:mm") 
                      : "N/A"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-400 rounded-full transition-colors"
                        onClick={() => openEditModal(log)}
                        title="Edit Log"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-full transition-colors"
                        onClick={() => setDeletingLog(log)}
                        title="Delete Log"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>


      {/* Edit Log Modal */}
      <Dialog open={!!editingLog} onOpenChange={(open) => !open && setEditingLog(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Call Log</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update the details of this call record.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={updateLog} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Employee Name</Label>
              <Input required value={editFormData.employeeName} onChange={e => setEditFormData({...editFormData, employeeName: e.target.value})} className="bg-slate-950 border-slate-700 text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Contact / Alias</Label>
              <Input value={editFormData.contactName} onChange={e => setEditFormData({...editFormData, contactName: e.target.value})} className="bg-slate-950 border-slate-700 text-white" placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Phone Number</Label>
              <Input required value={editFormData.phoneNumber} onChange={e => setEditFormData({...editFormData, phoneNumber: e.target.value})} className="bg-slate-950 border-slate-700 text-white" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Call Type</Label>
                <Select value={editFormData.callType} onValueChange={v => setEditFormData({...editFormData, callType: v})}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-white">
                    <SelectItem value="INCOMING">Incoming</SelectItem>
                    <SelectItem value="OUTGOING">Outgoing</SelectItem>
                    <SelectItem value="MISSED">Missed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">Duration (sec)</Label>
                <Input required type="number" min="0" value={editFormData.duration} onChange={e => setEditFormData({...editFormData, duration: parseInt(e.target.value) || 0})} className="bg-slate-950 border-slate-700 text-white" />
              </div>
            </div>
            <div className="space-y-2">
               <Label className="text-slate-300">Date & Time</Label>
               <Input required type="datetime-local" value={editFormData.timestamp} onChange={e => setEditFormData({...editFormData, timestamp: e.target.value})} className="bg-slate-950 border-slate-700 text-white style-color-scheme-dark" style={{ colorScheme: "dark" }} />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setEditingLog(null)} className="hover:bg-slate-800 text-slate-300">Cancel</Button>
              <Button type="submit" disabled={isUpdating} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                 {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                 Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deletingLog} onOpenChange={(open) => !open && setDeletingLog(null)}>
        <DialogContent className="bg-slate-900 border-rose-500/20 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center text-rose-500">
              <ShieldAlert className="w-5 h-5 mr-2" /> Delete Call Log
            </DialogTitle>
            <DialogDescription className="text-slate-400 pt-2 pb-4">
               Are you sure you want to delete this call record for <strong className="text-slate-200">{deletingLog?.phoneNumber}</strong> ({deletingLog?.callType})? 
               <br/><br/>
               This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
             <Button variant="ghost" onClick={() => setDeletingLog(null)} className="hover:bg-slate-800 text-slate-300 border border-slate-800">Cancel</Button>
             <Button variant="destructive" onClick={deleteLog} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700 text-white">
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Delete log"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
