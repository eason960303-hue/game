import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiService {
  static const String baseUrl = 'http://127.0.0.1:8000/api';

  static Future<List<dynamic>> fetchEntries() async {
    final response = await http.get(Uri.parse('$baseUrl/entries'));
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as List;
      return data;
    }
    throw Exception('Failed to load entries');
  }

  static Future<List<dynamic>> fetchLocations() async {
    final response = await http.get(Uri.parse('$baseUrl/location-points'));
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as List;
      return data;
    }
    throw Exception('Failed to load locations');
  }

  static Future<Map<String, dynamic>> fetchDashboard() async {
    final response = await http.get(Uri.parse('$baseUrl/dashboard'));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception('Failed to load dashboard');
  }

  static Future<Map<String, dynamic>> createEntry(
    Map<String, dynamic> payload,
  ) async {
    final response = await http.post(
      Uri.parse('$baseUrl/entries'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    if (response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(
      'Failed to create entry (${response.statusCode}): ${response.body}',
    );
  }

  static Future<dynamic> createLocationPoint(Map<String, dynamic> payload) async {
    final response = await http.post(
      Uri.parse('$baseUrl/location-points'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    if (response.statusCode == 201) {
      return jsonDecode(response.body);
    }
    throw Exception('Failed to create location point');
  }
}
