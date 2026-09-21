export type FarmName =
  | "Meriki Farm 2"
  | "Springdale Farm 1"
  | "Springdale Farm 2"
  | "Quarry Farm";

export type Trip = {
  id: string;
  farm: FarmName;
  startDate: string;
  endDate: string;
  batchSize: number;
  flightCost: number;
  accommodation: number;
  allowance: number;
  nzLabour: number;
  auCost: number;
};

export type Shed = {
  id: string;
  farm: FarmName;
  tripId: string;
  areaSqm: number;
  directCost: number;
  revenue: number;
  completionDate: string;
  status: "Complete";
};

export const trips: Trip[] = [
  { id: "MF2-01", farm: "Meriki Farm 2", startDate: "2024-03-04", endDate: "2024-03-14", batchSize: 4, flightCost: 4200, accommodation: 3450, allowance: 1900, nzLabour: 16300, auCost: 5400 },
  { id: "MF2-02", farm: "Meriki Farm 2", startDate: "2024-04-08", endDate: "2024-04-18", batchSize: 4, flightCost: 4380, accommodation: 3510, allowance: 1960, nzLabour: 16550, auCost: 5120 },
  { id: "MF2-03", farm: "Meriki Farm 2", startDate: "2024-05-13", endDate: "2024-05-23", batchSize: 4, flightCost: 4150, accommodation: 3680, allowance: 2020, nzLabour: 16900, auCost: 5480 },
  { id: "SF1-01", farm: "Springdale Farm 1", startDate: "2024-07-01", endDate: "2024-07-13", batchSize: 5, flightCost: 4560, accommodation: 4250, allowance: 2400, nzLabour: 20500, auCost: 6340 },
  { id: "SF1-02", farm: "Springdale Farm 1", startDate: "2024-08-05", endDate: "2024-08-17", batchSize: 5, flightCost: 4420, accommodation: 4380, allowance: 2450, nzLabour: 20900, auCost: 6180 },
  { id: "SF1-03", farm: "Springdale Farm 1", startDate: "2024-09-09", endDate: "2024-09-19", batchSize: 4, flightCost: 4280, accommodation: 3660, allowance: 1980, nzLabour: 16800, auCost: 5250 },
  { id: "SF2-01", farm: "Springdale Farm 2", startDate: "2025-02-03", endDate: "2025-02-15", batchSize: 5, flightCost: 4720, accommodation: 4460, allowance: 2520, nzLabour: 21100, auCost: 6520 },
  { id: "SF2-02", farm: "Springdale Farm 2", startDate: "2025-03-10", endDate: "2025-03-22", batchSize: 5, flightCost: 4680, accommodation: 4550, allowance: 2570, nzLabour: 21500, auCost: 6410 },
  { id: "SF2-03", farm: "Springdale Farm 2", startDate: "2025-04-14", endDate: "2025-04-24", batchSize: 4, flightCost: 4490, accommodation: 3820, allowance: 2080, nzLabour: 17300, auCost: 5590 },
  { id: "QF-01", farm: "Quarry Farm", startDate: "2025-07-07", endDate: "2025-07-17", batchSize: 4, flightCost: 4810, accommodation: 3940, allowance: 2140, nzLabour: 17850, auCost: 5820 },
  { id: "QF-02", farm: "Quarry Farm", startDate: "2025-08-11", endDate: "2025-08-21", batchSize: 4, flightCost: 4760, accommodation: 4020, allowance: 2180, nzLabour: 18100, auCost: 5960 },
  { id: "QF-03", farm: "Quarry Farm", startDate: "2025-09-15", endDate: "2025-09-25", batchSize: 4, flightCost: 4890, accommodation: 4080, allowance: 2210, nzLabour: 18400, auCost: 6110 },
];

const farmEconomics: Record<FarmName, { revenue: number; direct: number; area: number }> = {
  "Meriki Farm 2": { revenue: 90000, direct: 46300, area: 2250 },
  "Springdale Farm 1": { revenue: 85500, direct: 44700, area: 2140 },
  "Springdale Farm 2": { revenue: 88300, direct: 45900, area: 2210 },
  "Quarry Farm": { revenue: 92500, direct: 47900, area: 2320 },
};

export const sheds: Shed[] = trips.flatMap((trip) => {
  const base = farmEconomics[trip.farm];
  return Array.from({ length: trip.batchSize }, (_, index) => {
    const sequence = index + 1;
    const revenueAdjustment = ((index % 4) - 1.5) * 620;
    const costAdjustment = ((index % 3) - 1) * 410;

    return {
      id: `${trip.id}-S${String(sequence).padStart(2, "0")}`,
      farm: trip.farm,
      tripId: trip.id,
      areaSqm: base.area + index * 18,
      directCost: base.direct + costAdjustment,
      revenue: base.revenue + revenueAdjustment,
      completionDate: trip.endDate,
      status: "Complete" as const,
    };
  });
});

export const farmNames = Array.from(new Set(sheds.map((shed) => shed.farm)));

export function tripCost(trip: Trip) {
  return trip.flightCost + trip.accommodation + trip.allowance + trip.nzLabour + trip.auCost;
}

export function allocatedTripCost(trip: Trip) {
  return tripCost(trip) / trip.batchSize;
}

export function shedEconomics(shed: Shed, tripRecords: Trip[] = trips) {
  const trip = tripRecords.find((item) => item.id === shed.tripId);
  const logistics = trip ? allocatedTripCost(trip) : 0;
  const totalCost = shed.directCost + logistics;
  const margin = shed.revenue - totalCost;
  const marginPct = shed.revenue ? (margin / shed.revenue) * 100 : 0;

  return { logistics, totalCost, margin, marginPct };
}
