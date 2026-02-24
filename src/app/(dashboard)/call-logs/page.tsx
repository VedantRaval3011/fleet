"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "CUSTOM">("ALL");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

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
      console.error(error);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white">Call Logs</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium text-slate-400">Total Calls</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>
        {/* Placeholder for top cards logic, would compute from logs dynamically */}
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
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
                  className="text-white"
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                  No call logs found.
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log: any) => (
                <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/50">
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
