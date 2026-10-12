// Seeded, fictional data for the demo's documents (docs/features/demo-data-and-screenshots.md).
// Same seed, same instance: nothing here is random between runs. No real people or companies.

export class Rand {
  #state: number;
  constructor(seed: number) {
    this.#state = seed >>> 0;
  }
  /** mulberry32: [0, 1). */
  next() {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }
  /** By weight: `[[value, weight], ...]`. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let at = this.next() * total;
    for (const [value, weight] of items) {
      at -= weight;
      if (at < 0) return value;
    }
    return items[items.length - 1]?.[0] as T;
  }
  normal() {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Log-normal through a median and a 95th percentile. */
  logNormal(p50: number, p95: number) {
    const sigma = Math.log(Math.max(p95, p50 * 1.01) / p50) / 1.645;
    return p50 * Math.exp(sigma * this.normal());
  }
  digits(n: number) {
    return Array.from({ length: n }, () => this.int(0, 9)).join("");
  }
}

const first = [
  "Aaron",
  "Abigail",
  "Adrien",
  "Amara",
  "Ananya",
  "Benoît",
  "Bianca",
  "Caleb",
  "Camille",
  "Chloé",
  "Daniel",
  "Dmitri",
  "Elif",
  "Émile",
  "Fatima",
  "Felix",
  "Gabriel",
  "Grace",
  "Hamza",
  "Isabelle",
  "Jasmine",
  "Julien",
  "Kenji",
  "Laila",
  "Liam",
  "Mateo",
  "Mei",
  "Nadia",
  "Noor",
  "Olivier",
  "Owen",
  "Quinn",
  "Rafael",
  "Rosalie",
  "Sofia",
  "Tariq",
  "Theo",
  "Valérie",
  "Wei",
  "Yara",
  "Zoë",
];
const last = [
  "Abara",
  "Beaulieu",
  "Castellano",
  "Desjardins",
  "Eriksen",
  "Fontaine",
  "Gallagher",
  "Hassan",
  "Iwasaki",
  "Jovanovic",
  "Kowalczyk",
  "Lachance",
  "MacLeod",
  "Morrison",
  "Nakamura",
  "O'Donnell",
  "Pelletier",
  "Quintero",
  "Rasmussen",
  "Sandhu",
  "Takahashi",
  "Thibodeau",
  "Underwood",
  "Vasquez",
  "Whitcombe",
  "Xu",
  "Yilmaz",
  "Zielinski",
];
const companyFirst = [
  "Northwind",
  "Bayview",
  "Lakehead",
  "Cedar Ridge",
  "Granite Peak",
  "Riverbend",
  "Ironwood",
  "Maplecrest",
  "Fraser Valley",
  "Silverline",
  "Kingsway",
  "Harborview",
  "Prairie Sky",
  "Laurentian",
  "Coastal",
  "Blue Heron",
  "Stonebridge",
  "Westgate",
  "Timberline",
  "Red Pine",
  "Algonquin",
  "Summit",
  "Clearwater",
  "Highland",
  "Old Mill",
  "Tidewater",
  "Copper Creek",
];
const companyTrade = [
  "Construction",
  "Mechanical",
  "Electrical",
  "Paving",
  "Excavating",
  "Roofing",
  "Builders",
  "Civil Works",
  "Plumbing & Heating",
  "Concrete",
  "Landscaping",
  "Steel Erectors",
  "Glass & Glazing",
  "Demolition",
  "Utility Contractors",
  "Homes",
];
const companySuffix = ["Ltd.", "Inc.", "LLC", "Corp.", "Ltée", "Limited"];
const streets = [
  "King Street West",
  "Queen Street East",
  "Industrial Parkway",
  "Commerce Drive",
  "Rue Sainte-Catherine Ouest",
  "Boulevard René-Lévesque",
  "Portage Avenue",
  "Jasper Avenue",
  "Granville Street",
  "Barrington Street",
  "Main Street",
  "Lakeshore Road",
  "Dundas Street",
  "Mill Road",
  "Harbour Street",
  "Bay Street",
  "Wellington Street",
  "Hastings Street",
];
const cities = [
  ["Toronto", "ON", "M5V 2T6"],
  ["Mississauga", "ON", "L5B 3C2"],
  ["Hamilton", "ON", "L8P 4Y5"],
  ["Ottawa", "ON", "K1P 5J9"],
  ["Montréal", "QC", "H3B 4W8"],
  ["Québec", "QC", "G1R 4P5"],
  ["Laval", "QC", "H7T 2P5"],
  ["Winnipeg", "MB", "R3C 4T3"],
  ["Calgary", "AB", "T2P 2M5"],
  ["Edmonton", "AB", "T5J 2Z2"],
  ["Vancouver", "BC", "V6C 3L6"],
  ["Halifax", "NS", "B3J 3K5"],
] as const;
const oregon = [
  ["Portland", "OR 97204"],
  ["Salem", "OR 97301"],
  ["Eugene", "OR 97401"],
  ["Bend", "OR 97701"],
  ["Medford", "OR 97501"],
  ["Beaverton", "OR 97005"],
] as const;

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

export function personName(r: Rand) {
  return `${r.pick(first)} ${r.pick(last)}`;
}
export function company(r: Rand, suffixes: readonly string[] = companySuffix) {
  return `${r.pick(companyFirst)} ${r.pick(companyTrade)} ${r.pick(suffixes)}`;
}
export function address(r: Rand) {
  const [city, province, postal] = r.pick(cities);
  return {
    text: `${r.int(10, 9800)} ${r.pick(streets)}${r.chance(0.3) ? `, Suite ${r.int(2, 30)}00` : ""}\n${city}, ${province} ${postal}`,
    quebec: province === "QC",
  };
}
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]+/g, "")
    .slice(0, 16);

const policyNumber = (r: Rand, line: string) => `HS-${line}-${r.int(100000, 299999)}`;

/** The data for one document of each kind, around the day it's made. */
export const documents = {
  declarations(r: Rand, on: Date) {
    const insured = company(r);
    const where = address(r);
    const number = policyNumber(r, "CGL");
    const start = addDays(on, r.int(-5, 20));
    const coverages = [
      ["Bodily injury and property damage", 2000000, 5000],
      ["Products and completed operations", 2000000, 5000],
      ["Tenants' legal liability", 500000, 2500],
      ["Non-owned automobile", 2000000, 0],
      ["Contractor's equipment", 250000, 1000],
    ] as const;
    const picked = coverages
      .filter((_, i) => i < 2 || r.chance(0.5))
      .map(([name, base, deductible]) => ({
        name,
        limit: base * r.pick([1, 1, 2.5]),
        deductible,
        premium: Math.round(r.logNormal(3200, 14000)),
      }));
    return {
      lang: where.quebec ? "fr-CA" : "en",
      subject: number,
      data: {
        policy_number: number,
        period_start: isoDate(start),
        period_end: isoDate(addDays(start, 365)),
        broker_name: r.pick([
          "Lakeshore Commercial Insurance Brokers",
          "Cabinet Laurier Assurances",
          "Prairie Risk Partners",
          "Pacific Rim Brokerage",
        ]),
        insured_name: insured,
        mailing_address: where.text,
        business: r.pick([
          "Civil and municipal infrastructure contractor",
          "Commercial HVAC installation and service",
          "Residential and light commercial roofing",
          "Electrical contractor, industrial and institutional",
          "Road building and paving",
        ]),
        coverages: picked,
        total_premium: picked.reduce((sum, c) => sum + c.premium, 0),
        ...(r.chance(0.4)
          ? { endorsements: "Additional insured: as required by written contract (blanket)" }
          : {}),
      },
    };
  },

  certificate(r: Rand, on: Date) {
    const insured = company(r);
    const start = addDays(on, -r.int(10, 200));
    const end = addDays(start, 365);
    const holder = r.pick([
      ["City of Hamilton, Public Works Department", "71 Main Street West\nHamilton, ON L8P 4Y5"],
      ["Metrolinx", "97 Front Street West\nToronto, ON M5J 1E6"],
      ["Ville de Laval", "1, place du Souvenir\nLaval, QC H7V 1W7"],
      ["Brookfield Place Property Management", "181 Bay Street\nToronto, ON M5J 2T3"],
      ["University of Manitoba, Physical Plant", "66 Chancellors Circle\nWinnipeg, MB R3T 2N2"],
      ["Halifax Regional Municipality", "1841 Argyle Street\nHalifax, NS B3J 3A5"],
    ] as const);
    return {
      subject: insured,
      data: {
        certificate_number: `COI-${on.getUTCFullYear()}-${r.digits(6)}`,
        issued_on: isoDate(on),
        broker_name: "Lakeshore Commercial Insurance Brokers",
        insured_name: insured,
        insured_address: address(r).text,
        operations: r.pick([
          "Watermain replacement under contract PW-2026-114.",
          "Snow clearing and salting of the holder's parking structures.",
          "Tenant improvements, floors 12 to 14.",
          "Supply and installation of rooftop HVAC units.",
        ]),
        holder_name: holder[0],
        holder_address: holder[1],
        additional_insured: r.chance(0.6),
        policies: [
          {
            coverage: "Commercial general liability",
            policy_number: policyNumber(r, "CGL"),
            effective: isoDate(start),
            expiry: isoDate(end),
            limit: r.pick([2000000, 5000000]),
          },
          ...(r.chance(0.7)
            ? [
                {
                  coverage: "Automobile liability",
                  policy_number: policyNumber(r, "AUT"),
                  effective: isoDate(start),
                  expiry: isoDate(end),
                  limit: 2000000,
                },
              ]
            : []),
        ],
        cancellation_days: 30,
      },
    };
  },

  claims(r: Rand, on: Date) {
    const claimant = personName(r);
    return {
      subject: claimant,
      data: {
        claim_number: `CL-${String(on.getUTCFullYear()).slice(2)}-${r.digits(7)}`,
        policy_number: policyNumber(r, "CGL"),
        loss_date: isoDate(addDays(on, -r.int(1, 12))),
        loss_description: r.pick([
          "Vehicle damaged by debris from the insured's roofing work.",
          "Basement flooding after a service line was struck during excavation.",
          "Slip and fall on an unmarked wet floor at the insured's job site.",
          "Damage to a neighbouring fence during crane set-up.",
        ]),
        letter_date: isoDate(on),
        claimant_name: claimant,
        claimant_address: address(r).text,
        claimant_email: `${slug(claimant)}@mailbox.example`,
        adjuster_name: r.pick(["Daniel Osei", "Marie-Ève Côté", "Gurpreet Dhillon"]),
        adjuster_phone: `1-800-555-0137 ext. ${r.int(4100, 4499)}`,
        adjuster_email: "claims@harbour-surety.example",
        documents: [
          { name: "Photos of the damage" },
          { name: "Receipts or estimates for repairs" },
          ...(r.chance(0.5) ? [{ name: "A police or incident report number" }] : []),
        ],
      },
    };
  },

  renewal(r: Rand, on: Date) {
    const insured = company(r);
    const current = Math.round(r.logNormal(6200, 22000));
    return {
      subject: insured,
      data: {
        policy_number: policyNumber(r, "CGL"),
        insured_name: insured,
        insured_address: address(r).text,
        expiry_date: isoDate(addDays(on, 60)),
        current_premium: current,
        renewal_premium: Math.round(current * (1 + r.int(-3, 9) / 100)),
        ...(r.chance(0.35) ? { changes: "Cyber incident response endorsement added." } : {}),
        pre_authorized: r.chance(0.4),
        payment_due: isoDate(addDays(on, 45)),
        broker_name: "Lakeshore Commercial Insurance Brokers",
      },
    };
  },

  oregonBond(r: Rand, on: Date) {
    const principal = company(r, ["LLC", "Inc."]);
    const [city, zip] = r.pick(oregon);
    const coPrincipal = r.chance(0.2);
    return {
      subject: principal,
      data: {
        principal_name: principal,
        principal_address: `${r.int(100, 9900)} ${r.pick(["SE Division St", "NW Front Ave", "SW Macadam Ave", "NE Sandy Blvd"])}\n${city}, ${zip}`,
        ccb_license_number: r.digits(6),
        license_type: r.pick([
          "Residential General Contractor",
          "Residential Specialty Contractor",
          "Commercial General Contractor Level 2",
        ]),
        principal_signatory: personName(r),
        principal_signatory_title: r.pick(["Managing Member", "President", "Owner"]),
        has_co_principal: coPrincipal,
        ...(coPrincipal
          ? {
              co_principal_name: company(r, ["Inc.", "LLC"]),
              co_principal_address: `${r.int(100, 9900)} NW Overton Street\nPortland, OR 97209`,
              co_principal_signatory: personName(r),
              co_principal_signatory_title: "President",
            }
          : {}),
        surety_name: "Harbour Surety Company",
        surety_address: "900 SW Fifth Avenue, Suite 1200\nPortland, OR 97204",
        attorney_in_fact: "Robert J. Hargrove",
        obligee_name: "State of Oregon, Construction Contractors Board",
        obligee_address: "Salem, Oregon",
        bond_number: `OR-CLB-${on.getUTCFullYear()}-${r.digits(6)}`,
        penal_sum: r.pick([15000, 20000, 25000, 40000]),
        effective_date: isoDate(addDays(on, r.int(3, 20))),
        execution_date: isoDate(on),
      },
    };
  },

  ontarioCertificate(r: Rand, on: Date, signature: string) {
    const principal = company(r, ["Ltd.", "Inc."]);
    const contracts = Array.from({ length: r.int(1, 4) }, () => ({
      contract_number: `PW-${on.getUTCFullYear()}-${r.int(100, 199)}`,
      description: r.pick([
        "Watermain replacement, phase 2",
        "Storm sewer outfall",
        "Resurfacing and curb works",
        "Pumping station electrical upgrade",
        "Bridge deck rehabilitation",
      ]),
      contract_value: Math.round(r.logNormal(400000, 2000000) / 100) * 100,
    }));
    return {
      subject: principal,
      data: {
        bond_number: `SB-${r.int(200000, 299999)}`,
        principal,
        principal_address: address(r).text,
        obligee: r.pick([
          "City of Hamilton, Public Works Department",
          "Regional Municipality of Peel",
          "City of Ottawa, Infrastructure Services",
        ]),
        effective_date: isoDate(addDays(on, r.int(5, 30))),
        bond_amount: contracts.reduce((sum, c) => sum + c.contract_value, 0),
        bond_type: r.pick(["Performance bond", "Payment bond", "Performance bond"]),
        surety_company: "Harbour Surety Company",
        covered_contracts: contracts,
        include_rider: false,
        attorney_in_fact: "Margaret L. Chen",
        signature,
      },
    };
  },

  orCcb(r: Rand, on: Date) {
    const principal = company(r, ["Inc.", "LLC"]);
    const month = on.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    return {
      subject: principal,
      data: {
        principal_name: principal,
        ccb_number: r.chance(0.7) ? r.digits(6) : "",
        principal_email: `office@${slug(principal)}.example`,
        bond_number: `HS-OR-${r.digits(7)}`,
        penal_sum: r.pick(["20,000.00", "50,000.00", "75,000.00"]),
        surety_name: "Harbour Surety Company",
        dated_day: `${on.getUTCDate()}`,
        dated_month: month,
        dated_year: String(on.getUTCFullYear()).slice(2),
        attorney_name: "Robert J. Hargrove",
        attorney_title: "Attorney-in-fact",
        attorney_email: "rhargrove@harbour-surety.example",
        agency_address: "900 SW Fifth Avenue, Suite 1200 · (503) 555-0148",
        agency_city_state_zip: "Portland, OR 97204",
      },
    };
  },

  castlePines(r: Rand, on: Date) {
    const principal = company(r, ["LLC", "Inc."]);
    return {
      subject: principal,
      data: {
        principal_name: principal,
        principal_entity_type: "Colorado limited liability company",
        principal_office_address: `${r.int(100, 9900)} E Orchard Road, Greenwood Village, CO 80111`,
        surety_name: "Harbour Surety Company",
        bond_amount_words: "Twenty-five thousand and 00/100",
        bond_amount_numeric: 25000,
        permit_number: `${on.getUTCFullYear()}-${r.digits(4)}`,
        signed_day: on.getUTCDate(),
        signed_month: on.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
        signed_year: on.getUTCFullYear(),
        principal_address_line_1: `${r.int(100, 9900)} E Orchard Road`,
        principal_address_line_2: "Greenwood Village, CO 80111",
        surety_address_line_1: "1600 Broadway, Suite 900",
        surety_address_line_2: "Denver, CO 80202",
      },
    };
  },

  /** An HTML statement the policy system renders itself through /api/v1/render. */
  statement(r: Rand, on: Date) {
    const insured = company(r);
    const rows = Array.from({ length: r.int(3, 9) }, (_, i) => {
      const amount = Math.round(r.logNormal(900, 6000) * 100) / 100;
      return `<tr><td>${isoDate(addDays(on, -30 + i * 3))}</td><td>${r.pick(["Instalment", "Endorsement premium", "Policy fee", "Payment received"])}</td><td style="text-align:right">${amount.toFixed(2)}</td></tr>`;
    }).join("");
    return {
      subject: insured,
      filename: "premium-statement.pdf",
      html: `<h1>Premium statement</h1><p>${insured}<br>Statement date ${isoDate(on)}</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Date</th><th style="text-align:left">Item</th><th style="text-align:right">Amount (CAD)</th></tr></thead><tbody>${rows}</tbody></table><p>Harbour Surety Company · 181 Bay Street, Suite 2800, Toronto, ON</p>`,
    };
  },
};

export type DocumentKind = keyof typeof documents;
