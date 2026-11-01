class Entry {
  final int id;
  final String title;
  final String content;
  final String mood;
  final String? location;
  final String privacy;
  final String? tags;
  final String createdAt;
  final String? ownerName;
  final bool isOwner;

  Entry({
    required this.id,
    required this.title,
    required this.content,
    required this.mood,
    this.location,
    required this.privacy,
    this.tags,
    required this.createdAt,
    this.ownerName,
    this.isOwner = true,
  });

  List<String> get tagList {
    return (tags ?? '')
        .split(',')
        .map((tag) => tag.trim().replaceFirst('#', ''))
        .where((tag) => tag.isNotEmpty)
        .toList();
  }

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
      ownerName: json['owner_name'],
      isOwner: json['is_owner'] ?? true,
    );
  }
}
