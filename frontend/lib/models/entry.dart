class Entry {
  final int id;
  final String title;
  final String content;
  final String mood;
  final String? location;
  final String privacy;
  final String? tags;
  final String createdAt;

  Entry({
    required this.id,
    required this.title,
    required this.content,
    required this.mood,
    this.location,
    required this.privacy,
    this.tags,
    required this.createdAt,
  });

  factory Entry.fromJson(Map<String, dynamic> json) {
    return Entry(
      id: json['id'] ?? 0,
      title: json['title'] ?? '',
      content: json['content'] ?? '',
      mood: json['mood'] ?? 'happy',
      location: json['location'],
      privacy: json['privacy'] ?? 'private',
      tags: json['tags'],
      createdAt: json['created_at'] ?? '',
    );
  }
}
