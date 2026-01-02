const duties = data?.duties
  ? data.duties.map(d => ({
      startDate: d.startDate,
      duty: (d.dutyCodes && d.dutyCodes[0]) || "",
      flightNumber: (d.flights && d.flights.join(",")) || "",
      sector: (d.sectors && d.sectors.join(",")) || "",
      rpt: (d.times && d.times[0]) || "",
      signOff: (d.times && d.times[d.times.length - 1]) || "",
      dutyTime: "",
      hotel: (d.hotels && d.hotels.join(",")) || "",
      remarks: (d.remarks && d.remarks.join(" | ")) || "",
    }))
  : normalizeRowsToDuties(data);
