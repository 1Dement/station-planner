import type { Vec2 } from './vec2';
import type { Wall, Hole } from './wall-tool';

export interface IFCExportOptions {
  projectName?: string;
  siteName?: string;
  buildingName?: string;
  storeyName?: string;
  storeyElevation?: number;
  georefOriginX?: number;
  georefOriginY?: number;
  projectedCRS?: string;
  application?: string;
  holes?: Hole[];
}

interface MockWall {
  start: Vec2;
  end: Vec2;
  height?: number;
  thickness?: number;
}

type WallInput = Wall | MockWall;

function makeGuid(seed: number): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
  let s = '';
  let n = seed;
  for (let i = 0; i < 22; i++) {
    s += chars[(n + i * 17) % chars.length];
    n = Math.floor(n * 1.618033) + i + 1;
  }
  return s;
}

function nowIfcTimestamp(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function exportToIFC(walls: WallInput[], options: IFCExportOptions = {}): string {
  const opts: Required<IFCExportOptions> = {
    projectName: options.projectName ?? 'Station Planner Project',
    siteName: options.siteName ?? 'Default Site',
    buildingName: options.buildingName ?? 'Station Building',
    storeyName: options.storeyName ?? 'Ground Floor',
    storeyElevation: options.storeyElevation ?? 0,
    georefOriginX: options.georefOriginX ?? 0,
    georefOriginY: options.georefOriginY ?? 0,
    holes: options.holes ?? [],
    projectedCRS: options.projectedCRS ?? 'EPSG:3844',
    application: options.application ?? 'Station Planner',
  };

  const lines: string[] = [];
  let id = 1;
  const ref = (n: number) => `#${n}`;

  const ts = nowIfcTimestamp();

  // ─── HEADER ─────────────────────────────────────────────────────────────
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push("FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');");
  lines.push(`FILE_NAME('station.ifc','${ts}',('Station Planner User'),('UGA Aerial'),'${opts.application}','${opts.application}','');`);
  lines.push("FILE_SCHEMA(('IFC4'));");
  lines.push('ENDSEC;');
  lines.push('');
  lines.push('DATA;');

  // Reusable basics
  const personId = id++;
  lines.push(`#${personId} = IFCPERSON($,'User','Station Planner',$,$,$,$,$);`);
  const orgId = id++;
  lines.push(`#${orgId} = IFCORGANIZATION($,'UGA','UGA Aerial',$,$);`);
  const personOrgId = id++;
  lines.push(`#${personOrgId} = IFCPERSONANDORGANIZATION(${ref(personId)},${ref(orgId)},$);`);
  const appOrgId = id++;
  lines.push(`#${appOrgId} = IFCORGANIZATION($,'${opts.application}','${opts.application}',$,$);`);
  const appId = id++;
  lines.push(`#${appId} = IFCAPPLICATION(${ref(appOrgId)},'2.0','${opts.application}','SP');`);
  const ownerHistId = id++;
  const tsEpoch = Math.floor(Date.now() / 1000);
  lines.push(`#${ownerHistId} = IFCOWNERHISTORY(${ref(personOrgId)},${ref(appId)},$,.ADDED.,${tsEpoch},${ref(personOrgId)},${ref(appId)},${tsEpoch});`);

  // Units
  const unitMId = id++;
  lines.push(`#${unitMId} = IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
  const unitRadId = id++;
  lines.push(`#${unitRadId} = IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`);
  const unitAreaId = id++;
  lines.push(`#${unitAreaId} = IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);
  const unitVolId = id++;
  lines.push(`#${unitVolId} = IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);
  const unitAssignId = id++;
  lines.push(`#${unitAssignId} = IFCUNITASSIGNMENT((${ref(unitMId)},${ref(unitRadId)},${ref(unitAreaId)},${ref(unitVolId)}));`);

  // Geometric context
  const dirZ = id++; lines.push(`#${dirZ} = IFCDIRECTION((0.,0.,1.));`);
  const dirX = id++; lines.push(`#${dirX} = IFCDIRECTION((1.,0.,0.));`);
  const ptOrigin = id++; lines.push(`#${ptOrigin} = IFCCARTESIANPOINT((0.,0.,0.));`);
  const wcsId = id++;
  lines.push(`#${wcsId} = IFCAXIS2PLACEMENT3D(${ref(ptOrigin)},${ref(dirZ)},${ref(dirX)});`);
  const ctxId = id++;
  lines.push(`#${ctxId} = IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(wcsId)},$);`);

  // Project
  const projectId = id++;
  lines.push(`#${projectId} = IFCPROJECT('${makeGuid(projectId)}',${ref(ownerHistId)},'${opts.projectName}',$,$,$,$,(${ref(ctxId)}),${ref(unitAssignId)});`);

  // Site placement (LoGeoRef 50: model stays at origin; georef via IfcMapConversion)
  const sitePlacement = id++;
  lines.push(`#${sitePlacement} = IFCLOCALPLACEMENT($,${ref(wcsId)});`);
  const siteId = id++;
  lines.push(`#${siteId} = IFCSITE('${makeGuid(siteId)}',${ref(ownerHistId)},'${opts.siteName}',$,$,${ref(sitePlacement)},$,$,.ELEMENT.,$,$,$,$,$);`);

  // Building
  const bldgPlacement = id++;
  lines.push(`#${bldgPlacement} = IFCLOCALPLACEMENT(${ref(sitePlacement)},${ref(wcsId)});`);
  const buildingId = id++;
  lines.push(`#${buildingId} = IFCBUILDING('${makeGuid(buildingId)}',${ref(ownerHistId)},'${opts.buildingName}',$,$,${ref(bldgPlacement)},$,$,.ELEMENT.,$,$,$);`);

  // Storey
  const storeyPlacement = id++;
  const storeyOrigin = id++;
  lines.push(`#${storeyOrigin} = IFCCARTESIANPOINT((0.,0.,${opts.storeyElevation}));`);
  const storeyAxis = id++;
  lines.push(`#${storeyAxis} = IFCAXIS2PLACEMENT3D(${ref(storeyOrigin)},${ref(dirZ)},${ref(dirX)});`);
  lines.push(`#${storeyPlacement} = IFCLOCALPLACEMENT(${ref(bldgPlacement)},${ref(storeyAxis)});`);
  const storeyId = id++;
  lines.push(`#${storeyId} = IFCBUILDINGSTOREY('${makeGuid(storeyId)}',${ref(ownerHistId)},'${opts.storeyName}',$,$,${ref(storeyPlacement)},$,$,.ELEMENT.,${opts.storeyElevation});`);

  // Aggregations
  const relAggrSiteId = id++;
  lines.push(`#${relAggrSiteId} = IFCRELAGGREGATES('${makeGuid(relAggrSiteId)}',${ref(ownerHistId)},$,$,${ref(projectId)},(${ref(siteId)}));`);
  const relAggrBldgId = id++;
  lines.push(`#${relAggrBldgId} = IFCRELAGGREGATES('${makeGuid(relAggrBldgId)}',${ref(ownerHistId)},$,$,${ref(siteId)},(${ref(buildingId)}));`);
  const relAggrStoreyId = id++;
  lines.push(`#${relAggrStoreyId} = IFCRELAGGREGATES('${makeGuid(relAggrStoreyId)}',${ref(ownerHistId)},$,$,${ref(buildingId)},(${ref(storeyId)}));`);

  // Material
  const materialId = id++;
  lines.push(`#${materialId} = IFCMATERIAL('Concrete');`);
  const materialLayerId = id++;
  lines.push(`#${materialLayerId} = IFCMATERIALLAYER(${ref(materialId)},0.25,$);`);
  const materialLayerSetId = id++;
  lines.push(`#${materialLayerSetId} = IFCMATERIALLAYERSET((${ref(materialLayerId)}),'Wall25cm',$);`);

  // Walls + openings (doors/windows)
  const wallIds: number[] = [];
  const openingProductIds: number[] = []; // door/window IDs to add to spatial container
  const wallIdMap = new Map<string, { ifcId: number; placement: number; ang: number; len: number; height: number }>();

  for (const w of walls) {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ang = Math.atan2(dy, dx);
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const h = w.height ?? 3.0;
    const t = w.thickness ?? 0.25;

    const wpStart = id++;
    lines.push(`#${wpStart} = IFCCARTESIANPOINT((${w.start.x.toFixed(6)},${w.start.y.toFixed(6)},0.));`);
    const wpDirZ = id++; lines.push(`#${wpDirZ} = IFCDIRECTION((0.,0.,1.));`);
    const wpDirX = id++; lines.push(`#${wpDirX} = IFCDIRECTION((${cosA.toFixed(6)},${sinA.toFixed(6)},0.));`);
    const wpAxis = id++;
    lines.push(`#${wpAxis} = IFCAXIS2PLACEMENT3D(${ref(wpStart)},${ref(wpDirZ)},${ref(wpDirX)});`);
    const wpPlacement = id++;
    lines.push(`#${wpPlacement} = IFCLOCALPLACEMENT(${ref(storeyPlacement)},${ref(wpAxis)});`);

    // Profile (rectangle: length × thickness, centered on wall axis)
    const profPos = id++;
    const profOrigin = id++;
    lines.push(`#${profOrigin} = IFCCARTESIANPOINT((${(len/2).toFixed(6)},0.));`);
    const profDir = id++; lines.push(`#${profDir} = IFCDIRECTION((1.,0.));`);
    lines.push(`#${profPos} = IFCAXIS2PLACEMENT2D(${ref(profOrigin)},${ref(profDir)});`);
    const profileId = id++;
    lines.push(`#${profileId} = IFCRECTANGLEPROFILEDEF(.AREA.,'WallProfile',${ref(profPos)},${len.toFixed(6)},${t.toFixed(6)});`);

    const extDirId = id++;
    lines.push(`#${extDirId} = IFCDIRECTION((0.,0.,1.));`);
    const solidId = id++;
    lines.push(`#${solidId} = IFCEXTRUDEDAREASOLID(${ref(profileId)},${ref(wpAxis)},${ref(extDirId)},${h.toFixed(6)});`);
    const shapeRepId = id++;
    lines.push(`#${shapeRepId} = IFCSHAPEREPRESENTATION(${ref(ctxId)},'Body','SweptSolid',(${ref(solidId)}));`);
    const productShapeId = id++;
    lines.push(`#${productShapeId} = IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(shapeRepId)}));`);

    const wallId = id++;
    lines.push(`#${wallId} = IFCWALLSTANDARDCASE('${makeGuid(wallId)}',${ref(ownerHistId)},'Wall ${wallIds.length + 1}',$,$,${ref(wpPlacement)},${ref(productShapeId)},$,$);`);
    wallIds.push(wallId);
    if ((w as Wall).id) {
      wallIdMap.set((w as Wall).id, { ifcId: wallId, placement: wpPlacement, ang, len, height: h });
    }

    // Material association
    const relMatId = id++;
    lines.push(`#${relMatId} = IFCRELASSOCIATESMATERIAL('${makeGuid(relMatId)}',${ref(ownerHistId)},$,$,(${ref(wallId)}),${ref(materialLayerSetId)});`);
  }

  // ─── DOORS / WINDOWS ────────────────────────────────────────────────────
  for (const hole of opts.holes) {
    const wallInfo = wallIdMap.get(hole.wallId);
    if (!wallInfo) continue;
    if (hole.offset < 0 || hole.offset + hole.width > wallInfo.len + 1e-6) continue;

    const opCenterAlongWall = hole.offset + hole.width / 2;
    const sill = hole.sillHeight;
    const opH = hole.height;

    // Opening placement: relative to wall's IfcLocalPlacement
    // Wall axis is along local +X (we set wpDirX to (cosA, sinA)). So in wall-local coords,
    // opening center is at (opCenterAlongWall, 0, sill + opH/2).
    const opOriginPt = id++;
    lines.push(`#${opOriginPt} = IFCCARTESIANPOINT((${opCenterAlongWall.toFixed(6)},0.,0.));`);
    const opDirZ = id++; lines.push(`#${opDirZ} = IFCDIRECTION((0.,0.,1.));`);
    const opDirX = id++; lines.push(`#${opDirX} = IFCDIRECTION((1.,0.,0.));`);
    const opAxis = id++;
    lines.push(`#${opAxis} = IFCAXIS2PLACEMENT3D(${ref(opOriginPt)},${ref(opDirZ)},${ref(opDirX)});`);
    const opPlacement = id++;
    lines.push(`#${opPlacement} = IFCLOCALPLACEMENT(${ref(wallInfo.placement)},${ref(opAxis)});`);

    // Opening profile: width × thickness extruded by opH starting at sill height
    const opProfPos = id++;
    const opProfOrigin = id++;
    lines.push(`#${opProfOrigin} = IFCCARTESIANPOINT((0.,0.));`);
    const opProfDir = id++; lines.push(`#${opProfDir} = IFCDIRECTION((1.,0.));`);
    lines.push(`#${opProfPos} = IFCAXIS2PLACEMENT2D(${ref(opProfOrigin)},${ref(opProfDir)});`);
    const opProfile = id++;
    // Profile: width × (thickness + 0.05) so opening fully cuts through wall
    const cutThickness = (walls.find(ww => (ww as Wall).id === hole.wallId)?.thickness ?? 0.25) + 0.05;
    lines.push(`#${opProfile} = IFCRECTANGLEPROFILEDEF(.AREA.,'OpeningProfile',${ref(opProfPos)},${hole.width.toFixed(6)},${cutThickness.toFixed(6)});`);
    // Extrusion solid: starting at sill (z=sill), extruded up by opH
    const opSolidOrigin = id++;
    lines.push(`#${opSolidOrigin} = IFCCARTESIANPOINT((0.,0.,${sill.toFixed(6)}));`);
    const opSolidAxis = id++;
    lines.push(`#${opSolidAxis} = IFCAXIS2PLACEMENT3D(${ref(opSolidOrigin)},${ref(opDirZ)},${ref(opDirX)});`);
    const opExtrudeDir = id++;
    lines.push(`#${opExtrudeDir} = IFCDIRECTION((0.,0.,1.));`);
    const opSolid = id++;
    lines.push(`#${opSolid} = IFCEXTRUDEDAREASOLID(${ref(opProfile)},${ref(opSolidAxis)},${ref(opExtrudeDir)},${opH.toFixed(6)});`);
    const opShapeRep = id++;
    lines.push(`#${opShapeRep} = IFCSHAPEREPRESENTATION(${ref(ctxId)},'Body','SweptSolid',(${ref(opSolid)}));`);
    const opProductShape = id++;
    lines.push(`#${opProductShape} = IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(opShapeRep)}));`);

    // IfcOpeningElement
    const openingId = id++;
    lines.push(`#${openingId} = IFCOPENINGELEMENT('${makeGuid(openingId)}',${ref(ownerHistId)},'Opening',$,$,${ref(opPlacement)},${ref(opProductShape)},$,.OPENING.);`);

    // IfcRelVoidsElement: opening voids the wall
    const relVoids = id++;
    lines.push(`#${relVoids} = IFCRELVOIDSELEMENT('${makeGuid(relVoids)}',${ref(ownerHistId)},$,$,${ref(wallInfo.ifcId)},${ref(openingId)});`);

    // The actual door/window product (sits inside the opening)
    const productType = hole.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW';
    const predefined = hole.kind === 'door' ? '.DOOR.' : '.WINDOW.';
    const productId = id++;
    // IFC4: IfcDoor(GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, Tag, OverallHeight, OverallWidth, PredefinedType, OperationType, UserDefinedOperationType)
    if (hole.kind === 'door') {
      lines.push(`#${productId} = IFCDOOR('${makeGuid(productId)}',${ref(ownerHistId)},'Door',$,$,${ref(opPlacement)},${ref(opProductShape)},$,${opH.toFixed(6)},${hole.width.toFixed(6)},.DOOR.,$,$);`);
    } else {
      lines.push(`#${productId} = IFCWINDOW('${makeGuid(productId)}',${ref(ownerHistId)},'Window',$,$,${ref(opPlacement)},${ref(opProductShape)},$,${opH.toFixed(6)},${hole.width.toFixed(6)},.WINDOW.,$,$);`);
    }
    openingProductIds.push(productId);

    // IfcRelFillsElement: door/window fills the opening
    const relFills = id++;
    lines.push(`#${relFills} = IFCRELFILLSELEMENT('${makeGuid(relFills)}',${ref(ownerHistId)},$,$,${ref(openingId)},${ref(productId)});`);
  }

  // Contain walls + doors + windows in storey
  const allContained = [...wallIds, ...openingProductIds];
  if (allContained.length > 0) {
    const relContId = id++;
    const refs = allContained.map(w => `#${w}`).join(',');
    lines.push(`#${relContId} = IFCRELCONTAINEDINSPATIALSTRUCTURE('${makeGuid(relContId)}',${ref(ownerHistId)},$,$,(${refs}),${ref(storeyId)});`);
  }

  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');

  return lines.join('\n');
}

// Wall behavior + edge/corner detection live in wall-tool.ts (canonical)
