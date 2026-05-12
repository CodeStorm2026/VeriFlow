import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MismatchMinuteBucket {
  minute: string;
  count: number;
}

interface MismatchChartProps {
  data: MismatchMinuteBucket[];
}

const MismatchChart = ({ data }: MismatchChartProps) => {
  if (data.length === 0) {
    return (
      <div className="vf-card flex min-h-[160px] items-center justify-center p-4">
        <p className="vf-subtle text-sm">No data.</p>
      </div>
    );
  }

  return (
    <div className="vf-card p-4">
      <div className="mb-2 text-sm font-semibold">Mismatch / min</div>
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="minute" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="var(--vf-danger, #dc2626)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default MismatchChart;
