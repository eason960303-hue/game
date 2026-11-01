class AppUser {
  final int id;
  final String email;
  final String displayName;

  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) {
    return AppUser(
      id: json['id'] ?? 0,
      email: json['email'] ?? '',
      displayName: json['display_name'] ?? '',
    );
  }
}

class UserProfile {
  final String displayName;
  final String bio;
  final int followersCount;
  final int followingCount;

  const UserProfile({
    required this.displayName,
    required this.bio,
    required this.followersCount,
    required this.followingCount,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      displayName: json['display_name'] ?? '',
      bio: json['bio'] ?? '',
      followersCount: json['followers_count'] ?? 0,
      followingCount: json['following_count'] ?? 0,
    );
  }
}
