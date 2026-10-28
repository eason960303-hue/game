class LocationPoint {
  final int id;
  final String name;
  final double? latitude;
  final double? longitude;
  final String? note;
  final String createdAt;

  LocationPoint({
    required this.id,
    required this.name,
    this.latitude,
    this.longitude,
    this.note,
    required this.createdAt,
  });

  factory LocationPoint.fromJson(Map<String, dynamic> json) {
    return LocationPoint(
      id: json['id'] ?? 0,
      name: json['name'] ?? '',
      latitude: json['latitude'] != null ? (json['latitude'] as num).toDouble() : null,
      longitude: json['longitude'] != null ? (json['longitude'] as num).toDouble() : null,
      note: json['note'],
      createdAt: json['created_at'] ?? '',
    );
  }
}
