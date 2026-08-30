import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const TOOLTIP_STYLE = {
  background: "rgba(15,25,40,0.9)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "#e8f0fe",
};

export function AttendanceRevenueChart({ months }: { months: { month: string; visitors: number; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={months}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any, name: any) => [Number(v).toLocaleString(), name]} />
        <Legend />
        <Bar dataKey="visitors" fill="#22c55e" radius={[4, 4, 0, 0]} name="Visitors (scans)" />
        <Bar dataKey="revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Registration (₱)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function WeeklySalesChart({ week }: { week: { day: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={week}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Area type="monotone" dataKey="sales" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}