/* Credits to original demo at https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_CLOUD_PROBABILITY */

function get_filtered_s2sr(roi, start_date, end_date, max_cloud_probability) {
  //Actual Sentinel2 Surface Reflectance data, 20m
  var s2Sr = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');
  //Cloud probability band, 10m
  var s2Clouds = ee.ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY');
  
  function maskClouds(img) {
    var clouds = ee.Image(img.get('cloud_mask')).select('probability');
    var isNotCloud = clouds.lt(max_cloud_probability);
    return img.updateMask(isNotCloud).clip(roi);
  }
  
  // The masks for the 10m bands sometimes do not exclude bad data at
  // scene edges, so we apply masks from the 20m and 60m bands as well.
  // Example asset that needs this operation:
  // COPERNICUS/S2_CLOUD_PROBABILITY/20190301T000239_20190301T000238_T55GDP
  function maskEdges(s2_img) {
    return s2_img.updateMask(
        s2_img.select('B8A').mask().updateMask(s2_img.select('B9').mask()));
  }
  
  // Filter input collections by desired data range and region.
  var criteria = ee.Filter.and(
      ee.Filter.bounds(roi), ee.Filter.date(start_date, end_date));
  s2Sr = s2Sr.filter(criteria).map(maskEdges);
  s2Clouds = s2Clouds.filter(criteria);
  
  // Join S2 SR with cloud probability dataset to add cloud mask.
  var s2SrWithCloudMask = ee.Join.saveFirst('cloud_mask').apply({
    primary: s2Sr,
    secondary: s2Clouds,
    condition:
        ee.Filter.equals({leftField: 'system:index', rightField: 'system:index'})
  });
  
  
  var s2CloudMasked =
      ee.ImageCollection(s2SrWithCloudMask).map(maskClouds);
  
  
  return s2CloudMasked
}

exports.get_filtered_s2sr = function(region, start_date, end_date, max_cloud_probability){
  /* This is just the exportable copy of the function above, for use in other scripts. */
  return get_filtered_s2sr(region, start_date, end_date, max_cloud_probability);
}

/*
var start_date = ee.Date('2019-01-01');
var end_date = ee.Date('2019-03-01');
var max_cloud_probability = 65;
var region =ee.Geometry.Rectangle({coords: [-76.5, 2.0, -74, 4.0], geodesic: false});


var s2CloudMasked= get_filtered_s2sr(region, start_date, end_date, max_cloud_probability)
var rgbVis = {min: 0, max: 3000, bands: ['B4', 'B3', 'B2']};
Map.addLayer(
    s2CloudMasked, rgbVis, 'S2 SR masked at ' + max_cloud_probability + '%',
    true);
print(region.centroid({maxError:1}).coordinates().get(0))
Map.setCenter(ee.Number(region.centroid({maxError:1}).coordinates().get(0)),
  ee.Number(region.centroid({maxError:1}).coordinates().get(1)), 10)*/
