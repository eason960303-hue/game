/// Decodes Google's encoded polyline format into latitude and longitude pairs.
List<(double, double)> decodePolyline(String encoded) {
  final points = <(double, double)>[];
  var index = 0;
  var latitude = 0;
  var longitude = 0;

  int? nextDelta() {
    var result = 0;
    var shift = 0;
    while (index < encoded.length) {
      final chunk = encoded.codeUnitAt(index++) - 63;
      result |= (chunk & 0x1f) << shift;
      shift += 5;
      if (chunk < 0x20) {
        return result.isOdd ? ~(result >> 1) : result >> 1;
      }
    }
    return null;
  }

  while (index < encoded.length) {
    final latitudeDelta = nextDelta();
    final longitudeDelta = nextDelta();
    if (latitudeDelta == null || longitudeDelta == null) break;
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    points.add((latitude / 1e5, longitude / 1e5));
  }
  return points;
}

String formatRouteDuration(int seconds) {
  final totalMinutes = (seconds / 60).round().clamp(1, 1 << 31);
  final hours = totalMinutes ~/ 60;
  final minutes = totalMinutes % 60;
  if (hours == 0) return '$minutes 分鐘';
  return minutes == 0 ? '$hours 小時' : '$hours 小時 $minutes 分鐘';
}

String formatRouteDistance(int meters) {
  return meters >= 1000
      ? '${(meters / 1000).toStringAsFixed(1)} 公里'
      : '$meters 公尺';
}
