import 'dart:async';

import 'package:geolocator/geolocator.dart';

class LocationException implements Exception {
  const LocationException(this.message);

  final String message;

  @override
  String toString() => message;
}

typedef Coordinates = ({double latitude, double longitude});

Future<Coordinates> currentCoordinates() async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw const LocationException('請先開啟裝置的定位服務');
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  if (permission == LocationPermission.denied ||
      permission == LocationPermission.deniedForever) {
    throw const LocationException('沒有定位權限，請到系統設定開啟，或手動輸入座標');
  }
  try {
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    return (latitude: position.latitude, longitude: position.longitude);
  } on TimeoutException {
    throw const LocationException('定位逾時，請到空曠處再試，或手動輸入座標');
  }
}
