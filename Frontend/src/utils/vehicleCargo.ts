export type VehicleBodyType = 'semi-reefer' | 'box-truck' | 'sprinter-van' | 'cryo-carrier';

export interface VehicleCargoProfile {
  bodyType: VehicleBodyType;
  vehicleClassLabel: string;
  cargoShortLabel: string;
  cargoCategory:
  | 'vaccines'
  | 'insulin'
  | 'antibodies'
  | 'plasma'
  | 'reagents'
  | 'pediatric'
  | 'oncology'
  | 'trials'
  | 'general';
  accentHex: string;
  badgeBgClass: string;
  badgeTextClass: string;
  badgeBorderClass: string;
}

export function getVehicleCargoProfile(
  vehicleName: string,
  cargoType: string
): VehicleCargoProfile {
  const v = vehicleName.toLowerCase();
  const c = cargoType.toLowerCase();

  let bodyType: VehicleBodyType = 'box-truck';
  let vehicleClassLabel = 'Reefer Box Truck';

  if (v.includes('hardware') || v.includes('live iot') || v.includes('live tracker') || v.includes('gw-001')) {
    return {
      bodyType: 'sprinter-van',
      vehicleClassLabel: 'Live Hardware Tracker',
      cargoShortLabel: 'Live Vaccine',
      cargoCategory: 'vaccines',
      accentHex: '#0284c7',
      badgeBgClass: 'bg-cyan-50',
      badgeTextClass: 'text-cyan-800 font-bold',
      badgeBorderClass: 'border-cyan-300',
    };
  }

  if (v.includes('sprinter') || v.includes('van') || v.includes('vaxfleet')) {
    bodyType = 'sprinter-van';
    vehicleClassLabel = 'Cold Sprinter Van';
  } else if (v.includes('pharma') || v.includes('coldhaul')) {
    bodyType = 'semi-reefer';
    vehicleClassLabel = 'Heavy Reefer Semi';
  } else if (v.includes('reserve') || v.includes('medline')) {
    bodyType = 'cryo-carrier';
    vehicleClassLabel = 'Insulated Carrier';
  }

  if (c.includes('mrna')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'mRNA Vaccines',
      cargoCategory: 'vaccines',
      accentHex: '#2563eb',
      badgeBgClass: 'bg-blue-50',
      badgeTextClass: 'text-blue-700',
      badgeBorderClass: 'border-blue-200',
    };
  }
  if (c.includes('insulin')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Insulin',
      cargoCategory: 'insulin',
      accentHex: '#0d9488',
      badgeBgClass: 'bg-teal-50',
      badgeTextClass: 'text-teal-700',
      badgeBorderClass: 'border-teal-200',
    };
  }
  if (c.includes('monoclonal') || c.includes('antibod')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'mAb Antibodies',
      cargoCategory: 'antibodies',
      accentHex: '#0284c7',
      badgeBgClass: 'bg-sky-50',
      badgeTextClass: 'text-sky-700',
      badgeBorderClass: 'border-sky-200',
    };
  }
  if (c.includes('plasma')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Plasma',
      cargoCategory: 'plasma',
      accentHex: '#0d9488',
      badgeBgClass: 'bg-teal-50',
      badgeTextClass: 'text-teal-700',
      badgeBorderClass: 'border-teal-200',
    };
  }
  if (c.includes('reagent') || c.includes('diagnostic')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Reagents',
      cargoCategory: 'reagents',
      accentHex: '#0284c7',
      badgeBgClass: 'bg-sky-50',
      badgeTextClass: 'text-sky-700',
      badgeBorderClass: 'border-sky-200',
    };
  }
  if (c.includes('pediatric')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Pediatric Vax',
      cargoCategory: 'pediatric',
      accentHex: '#059669',
      badgeBgClass: 'bg-emerald-50',
      badgeTextClass: 'text-emerald-700',
      badgeBorderClass: 'border-emerald-200',
    };
  }
  if (c.includes('oncology')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Oncology',
      cargoCategory: 'oncology',
      accentHex: '#ea580c',
      badgeBgClass: 'bg-orange-50',
      badgeTextClass: 'text-orange-700',
      badgeBorderClass: 'border-orange-200',
    };
  }
  if (c.includes('clinical') || c.includes('trial')) {
    return {
      bodyType,
      vehicleClassLabel,
      cargoShortLabel: 'Trial Samples',
      cargoCategory: 'trials',
      accentHex: '#0369a1',
      badgeBgClass: 'bg-blue-50',
      badgeTextClass: 'text-blue-700',
      badgeBorderClass: 'border-blue-200',
    };
  }

  return {
    bodyType,
    vehicleClassLabel,
    cargoShortLabel: cargoType.split('(')[0].trim() || 'Cold Cargo',
    cargoCategory: 'general',
    accentHex: '#334155',
    badgeBgClass: 'bg-slate-100',
    badgeTextClass: 'text-slate-700',
    badgeBorderClass: 'border-slate-200',
  };
}
