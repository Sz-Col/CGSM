// =========================================================
// CGSM – Complejo Pajarales NDVI Analysis & Visualization
// =========================================================
//
//               ┌────────────────────────────────────────┐
//               │      HIGH-LEVEL OVERVIEW (STRUCTURE)   │
//               ├────────────────────────────────────────┤
//               │ 1️⃣ SETTINGS & AOI DEFINITION           │
//               │     • Define Area of Interest (AOI)     │
//               │     • Set NDVI threshold & parameters   │
//               │     • Initialize export folder & layout │
//               ├────────────────────────────────────────┤
//               │ 2️⃣ SENTINEL-2 DATASET & MASKING        │
//               │     • Load S2_SR_HARMONIZED collection  │
//               │     • Apply QA60 cloud mask             │
//               │     • Clip and clean imagery for AOI    │
//               ├────────────────────────────────────────┤
//               │ 3️⃣ SECTION A – 18-MONTH NDVI STATS     │
//               │     • Compute monthly median NDVI       │
//               │     • Derive vegetation area ≥ 0.40     │
//               │     • Count valid pixels & scene count  │
//               │     • Export CSV + trend chart          │
//               ├────────────────────────────────────────┤
//               │ 4️⃣ SECTION B – 7 VISUAL EXPORT FRAMES  │
//               │     • Select 7 months (bi-monthly)      │
//               │     • Blend NDVI mask with RGB base     │
//               │     • Export images (AOI + overlay)     │
//               └────────────────────────────────────────┘
//
// =========================================================
// Authors: Combined and annotated by Horst Salzwedel & GPT-5
// Purpose: Long-term NDVI (≥0.40) vegetation monitoring and
//          bi-monthly Hydrilla coverage visualization in
//          the Complejo Pajarales sector (CGSM, Colombia).
// =========================================================



// =========================================================
// 1️⃣ SETTINGS AND AOI DEFINITION
// =========================================================

// Area of Interest (AOI) – Complejo Pajarales polygon - 1204 ha
var AOI = ee.Geometry.Polygon([[
  [-74.5921864,10.8397632],
  [-74.5924010,10.8192778],
  [-74.5436919,10.8197415],
  [-74.5434774,10.8399739],
  [-74.5921864,10.8397632]
]]);

// NDVI and general parameters
var NDVI_THR   = 0.40;      // NDVI threshold for vegetation
var CLOUDY_PCT = 80;        // maximum cloudiness (%)
var SCALE_STAT = 30;        // scale for statistical analysis (ha)
var TILE_SCALE = 8;         // parallelization factor for reducers
var SCALE_VIS  = 10;        // scale for visualization (m)
var BUFFER_M   = 2500;      // buffer for export frame around AOI
var EXPORT_FOLDER = 'CGSM_Pajarales'; // Google Drive folder

// AOI outline (yellow for visualization)
var AOI_outline = ee.Image().byte().paint(AOI, 1, 2).visualize({palette: ['#ffff00']});



// =========================================================
// 2️⃣ SENTINEL-2 DATASET & CLOUD MASK FUNCTION
// =========================================================

// Cloud masking function using QA60 bits
function maskS2_QA60(img) {
  var qa = img.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0)  // clouds
           .and(qa.bitwiseAnd(1 << 11).eq(0)); // cirrus
  return img.updateMask(mask)
            .updateMask(img.select('B8').gt(0))
            .updateMask(img.select('B4').gt(0))
            .clip(AOI);
}

// Load Sentinel-2 SR Harmonized collection
var s2_base = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(AOI)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CLOUDY_PCT))
  .map(maskS2_QA60);



// =========================================================
// 3️⃣ SECTION A — 18-MONTH STATISTICAL NDVI ANALYSIS
// =========================================================

// Define 18-month window (last 18 full months)
var today   = ee.Date(Date.now());
var endFull = today.advance(-1, 'month');         // exclude current month
var start18 = endFull.advance(-17, 'month');      // 18-month range
print('18-month window:', start18.format('YYYY-MM'), '→', endFull.format('YYYY-MM'));

// Generate list of all months in range
function monthList(s, e) {
  s = ee.Date(s).update({day: 1});
  var n = e.difference(s, 'month').add(1).toInt();
  return ee.List.sequence(0, n.subtract(1))
           .map(function(i){ return s.advance(i, 'month'); });
}
var months = monthList(start18, endFull);

// Create monthly median NDVI composites
function monthlyComposite(m0){
  m0 = ee.Date(m0);
  var m1  = m0.advance(1, 'month');
  var col = s2_base.filterDate(m0, m1);

  var nScenes = ee.Number(
    col.aggregate_array('DATATAKE_IDENTIFIER').distinct().size()
  );

  var ndviMedian = ee.ImageCollection(col.map(function(img){
      return ee.Image(img).normalizedDifference(['B8','B4']).rename('NDVI');
    }))
    .median()
    .rename('NDVI');

  var empty = ee.Image.constant(0).updateMask(ee.Image.constant(0)).rename('NDVI');

  return ee.Image(ee.Algorithms.If(nScenes.gt(0), ndviMedian, empty))
    .set({
      'month_start': m0.format('YYYY-MM'),
      'system:time_start': m0.millis(),
      'n_scenes': nScenes
    });
}

// Apply monthly composite generation
var monthlyNDVI = ee.ImageCollection.fromImages(months.map(monthlyComposite))
  .sort('system:time_start');

// Extract monthly NDVI stats (area & valid fraction)
var monthlyFC = ee.FeatureCollection(monthlyNDVI.map(function(ndviImg){
  var ndvi  = ee.Image(ndviImg).select('NDVI').clip(AOI);
  var valid = ndvi.mask();
  var veg   = ndvi.gte(NDVI_THR).updateMask(valid);

  var areaBand  = ee.Image.pixelArea().updateMask(veg).rename('area');
  var validBand = valid.rename('valid');

  var reducer = ee.Reducer.sum().combine({
    reducer2: ee.Reducer.mean(), sharedInputs: true
  });

  var stats = ee.Image.cat(areaBand, validBand).reduceRegion({
    reducer: reducer,
    geometry: AOI,
    scale: SCALE_STAT,
    tileScale: TILE_SCALE,
    bestEffort: true,
    maxPixels: 1e13
  });

  var areaHa    = ee.Number(stats.get('area_sum')).divide(10000);
  var validFrac = ee.Number(stats.get('valid_mean'));
  var nScenes   = ee.Number(ndviImg.get('n_scenes'));

  return ee.Feature(null, {
    month      : ee.String(ndviImg.get('month_start')),
    area_ha    : areaHa,
    valid_frac : validFrac,
    n_scenes   : nScenes,
    'system:time_start': ndviImg.get('system:time_start')
  });
})).sort('system:time_start');

// Display sample results
print('Preview (first 3 months):', monthlyFC.limit(3));
print('AOI area (ha):', AOI.area(1).divide(10000));
print('Total months analyzed:', monthlyFC.size());

// Export monthly NDVI statistics to Google Drive as CSV
Export.table.toDrive({
  collection: monthlyFC,
  description: 'Pajarales_NDVI040_monthly_median_18m',
  folder: EXPORT_FOLDER,
  fileFormat: 'CSV'
});

// Optional: NDVI coverage trend chart
var chart = ui.Chart.feature.byFeature(monthlyFC, 'month', 'area_ha')
  .setChartType('LineChart')
  .setOptions({
    title: 'Monthly Median Area with NDVI ≥ 0.40 (last 18 full months)',
    hAxis: { title: 'Month', slantedText: true },
    vAxis: { title: 'Area (ha)' },
    legend: { position: 'none' },
    lineWidth: 2,
    pointSize: 4
  });
print(chart);



// =========================================================
// 4️⃣ SECTION B — 7 BI-MONTHLY VISUAL OVERLAYS
// =========================================================
// Generates 7 visual exports with TrueColor + red NDVI≥0.40 mask
// =========================================================

// Selected months (2-month intervals)
var MONTHS7 = ['2024-10','2024-12','2025-02','2025-04','2025-06','2025-08','2025-10'];

// Visualization parameters
var visRGB = {bands:['B4','B3','B2'], min:0, max:3000};
var regionExport = AOI.buffer(BUFFER_M).bounds({maxError: 10});

// Function to create one visual frame
function monthFrame(ym){
  ym = ee.String(ym);
  var m0 = ee.Date.parse('YYYY-MM', ym);
  var m1 = m0.advance(1, 'month');

  var col = s2_base.filterDate(m0, m1);

  var ndviMed = ee.ImageCollection(col.map(function(img){
      return ee.Image(img).normalizedDifference(['B8','B4']).rename('NDVI');
    }))
    .median()
    .rename('NDVI');

  var veg = ndviMed.gte(NDVI_THR).selfMask();

  var areaHa = ee.Number(
    ee.Image.pixelArea().updateMask(veg).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: AOI,
      scale: SCALE_STAT,
      tileScale: TILE_SCALE,
      bestEffort: true,
      maxPixels: 1e13
    }).get('area')
  ).divide(10000);

  // TrueColor median background
  var rgbMed = ee.ImageCollection(col).median().visualize(visRGB);

  // Red overlay for Hydrilla vegetation
  var redMask = veg.visualize({palette:['#ff0000'], opacity:0.6});

  // Composite layers: RGB + red NDVI mask + AOI outline
  var frame = rgbMed.blend(redMask).blend(AOI_outline);

  // Export name includes month and rounded area
  var haStr = areaHa.format('%.0f');
  var desc  = ee.String('Pajarales_').cat(ym).cat('_').cat(haStr).cat('ha');

  // Export to Drive
  Export.image.toDrive({
    image: frame,
    description: desc.getInfo(),
    folder: EXPORT_FOLDER,
    fileNamePrefix: desc.getInfo(),
    region: regionExport,
    scale: SCALE_VIS,
    maxPixels: 1e13
  });

  return ee.Feature(null, {month: ym, area_ha: areaHa});
}

// Execute visual exports for all 7 months
var fc7 = ee.FeatureCollection(MONTHS7.map(monthFrame));
print('Seven exported frames (month & area_ha):', fc7);
