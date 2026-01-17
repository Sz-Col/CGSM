var geometry = 
    /* color: #d63000 */
    /* shown: false */
    ee.Geometry.Polygon(
        [[[-74.61411596960272, 10.829045512816178],
          [-74.61068274206366, 10.816231300319165],
          [-74.61119772619452, 10.79105479581324],
          [-74.60879446691717, 10.775540821921297],
          [-74.58218695348944, 10.772336749407717],
          [-74.57240225500311, 10.781948864638203],
          [-74.55660940832342, 10.798685650401252],
          [-74.5370402527896, 10.815041936973051],
          [-74.52914358801092, 10.827349939881366],
          [-74.50768591589178, 10.831396442351124],
          [-74.48451163000311, 10.836454493545562],
          [-74.4838249844953, 10.844041410065644],
          [-74.4944676941174, 10.851459251908537],
          [-74.50682731325803, 10.85685414159808],
          [-74.50493903811154, 10.860394485014938],
          [-74.51266380007444, 10.88045563790864],
          [-74.5329198425549, 10.884838567318647],
          [-74.54493613894162, 10.88399570128454],
          [-74.55420585329709, 10.862754690644051],
          [-74.5717563781058, 10.851668173729724],
          [-74.59613229363315, 10.846610379742115],
          [-74.60385705559604, 10.841721097568819]]]);
// ======================================================

// 1) Área de interés
// ======================================================
var AOI = geometry;

// ======================================================
// 2) Sentinel-2 SR
// ======================================================
var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(AOI)
  .filterDate("2022-01-01", "2022-03-28")
  .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
  .median()
  .clip(AOI);


// ======================================================
// 3) NDWI
// ======================================================
var ndwi = s2.normalizedDifference(["B3", "B8"]).rename("NDWI");

// ======================================================
// 4) FUNCION OTSU GEE PARA ESPEJO DE AGUA
// ======================================================
function otsu(image, region, scale) {

  var histogram = image.reduceRegion({
    reducer: ee.Reducer.histogram({maxBuckets: 256}),
    geometry: region,
    scale: scale,
    bestEffort: true
  }).get("NDWI");

  histogram = ee.Dictionary(histogram);
  var counts = ee.Array(histogram.get("histogram"));
  var means  = ee.Array(histogram.get("bucketMeans"));

  // Hacer listas para poder usar .get() con índices simples
  var countsList = counts.toList();
  var meansList  = means.toList();

  var size = countsList.length();
  var total = ee.Number(countsList.reduce(ee.Reducer.sum()));

  var sum = ee.Number(
    ee.List.sequence(0, size.subtract(1))
      .map(function(i){
        return ee.Number(countsList.get(i))
               .multiply(meansList.get(i));
      })
      .reduce(ee.Reducer.sum())
  );

  var globalMean = sum.divide(total);

  // Evaluar todos los posibles umbrales
  var bcList = ee.List.sequence(1, size.subtract(1)).map(function(i){
    i = ee.Number(i);

    var c1 = ee.Number(
      countsList.slice(0, i).reduce(ee.Reducer.sum())
    );
    var c2 = total.subtract(c1);

    var m1 = ee.Number(
      ee.List.sequence(0, i.subtract(1)).map(function(j){
        return ee.Number(countsList.get(j))
               .multiply(meansList.get(j));
      }).reduce(ee.Reducer.sum())
    ).divide(c1);

    var m2 = ee.Number(
      ee.List.sequence(i, size.subtract(1)).map(function(j){
        return ee.Number(countsList.get(j))
               .multiply(meansList.get(j));
      }).reduce(ee.Reducer.sum())
    ).divide(c2);

    return c1.multiply(c2).multiply(m1.subtract(m2).pow(2));
  });

  var maxBC = ee.Number(bcList.reduce(ee.Reducer.max()));
  var index = bcList.indexOf(maxBC);

  var threshold = meansList.get(index);

  return ee.Number(threshold);
}

var threshold = otsu(ndwi, AOI, 10);
print("Umbral NDWI (Otsu):", threshold);

// ======================================================
// 5) Máscara de agua
// ======================================================
var water = ndwi.gt(threshold).selfMask();

// ======================================================
// 6) Polígonos
// ======================================================
var waterVectors = water.reduceToVectors({
  geometry: AOI,
  scale: 10,
  geometryType: "polygon",
  eightConnected: true,
  maxPixels: 1e13
});

// ======================================================
// 7) Visualización mínima
// ======================================================
Map.setOptions("SATELLITE");
Map.centerObject(AOI, 12);
Map.addLayer(waterVectors, {color:"cyan"}, "Polígono agua");
Map.addLayer(AOI, {color:"yellow"}, "AOI");

// ======================================================
// 8) Exportar resultado
// ======================================================
Export.table.toDrive({
  collection: waterVectors,
  description: "Poligono_Agua_2022_Bimestre",
  fileFormat: "KML"
});

///////////////////////
/////////////////////////////////////////////////
//////////////////////////////////////////////
//////////Nuevo código para dejar el polígono más grande

// ======================================================
// QUEDARSE SOLO CON EL POLÍGONO MÁS GRANDE
// ======================================================

// 1) Asegurar geometrías válidas con margen de error
var polysFixed = waterVectors.map(function(f) {
  var geom = f.geometry().simplify(1);  // 1 metro de tolerancia
  return ee.Feature(geom).copyProperties(f);
});

// 2) Añadir área en m² con margen de error explícito
var polysWithArea = polysFixed.map(function(f) {
  var area = f.geometry(1).area(1);   // (maxError = 1 m)
  return f.set('area_m2', area);
});

// 3) Obtener el área máxima
var maxArea = polysWithArea.aggregate_max('area_m2');
print('Área máxima encontrada (m²):', maxArea);

// 4) Filtrar solo el polígono más grande
var largestPoly = polysWithArea
  .filter(ee.Filter.eq('area_m2', maxArea))
  .first();

// Convertir a FeatureCollection
var largestPolyFC = ee.FeatureCollection([largestPoly]);
print('Polígono más grande:', largestPolyFC);


// 5) Mostrar en el mapa
Map.addLayer(largestPolyFC, {color: 'red'}, 'Polígono más grande');

// 6) Exportar a Drive
Export.table.toDrive({
  collection: largestPolyFC,
  description: 'Poligono_Agua_Mas_Grande',
  fileFormat: 'SHP'   
});

// ======================================================
// 9) Imprimir área del polígono más grande en el mapa
// ======================================================

// Obtener área en hectáreas
var areaHa = ee.Number(maxArea).divide(10000);

// Crear etiqueta
var label = ui.Label({
  value: 'Espejo de agua del Complejo Pajarales: ' + areaHa.format('%.2f').getInfo() + ' ha',
  style: {
    position: 'top-left',
    padding: '8px',
    fontSize: '16px',
    backgroundColor: 'rgba(0,0,0,0.4)',
    color: 'white'
  }
});

// Mostrar en la interfaz
Map.add(label);
