package app

import (
	localproject "infinite-canvas/backend/internal/project"
)

type CreateProjectCharacterRequest = localproject.CreateProjectCharacterRequest
type UpdateProjectCharacterRequest = localproject.UpdateProjectCharacterRequest
type CharacterRepresentationInput = localproject.CharacterRepresentationInput
type ReplaceCharacterRepresentationsRequest = localproject.ReplaceCharacterRepresentationsRequest
type BindCharacterVoiceRequest = localproject.BindCharacterVoiceRequest
type CharacterRepresentationSummary = localproject.CharacterRepresentationSummary
type VoiceProfileSummary = localproject.VoiceProfileSummary
type CharacterVoiceSummary = localproject.CharacterVoiceSummary
type CharacterCardSummary = localproject.CharacterCardSummary
type ProjectCharacterDetail = localproject.CharacterDetail

func (s *Service) ListVoiceProfiles(userID string) ([]VoiceProfileSummary, error) {
	return s.projectDomain().ListVoiceProfiles(userID)
}

func (s *Service) CreateProjectCharacter(userID string, projectID string, req CreateProjectCharacterRequest) (ProjectCharacterDetail, error) {
	return s.projectDomain().CreateProjectCharacter(userID, projectID, req)
}

func (s *Service) ProjectCharacter(userID string, projectID string, assetID string) (ProjectCharacterDetail, error) {
	return s.projectDomain().ProjectCharacter(userID, projectID, assetID)
}

func (s *Service) UpdateProjectCharacter(userID string, projectID string, assetID string, req UpdateProjectCharacterRequest) (ProjectCharacterDetail, error) {
	return s.projectDomain().UpdateProjectCharacter(userID, projectID, assetID, req)
}

func (s *Service) ReplaceProjectCharacterRepresentations(userID string, projectID string, assetID string, req ReplaceCharacterRepresentationsRequest) (ProjectCharacterDetail, error) {
	return s.projectDomain().ReplaceProjectCharacterRepresentations(userID, projectID, assetID, req)
}

func (s *Service) BindProjectCharacterVoice(userID string, projectID string, assetID string, req BindCharacterVoiceRequest) (ProjectCharacterDetail, error) {
	return s.projectDomain().BindProjectCharacterVoice(userID, projectID, assetID, req)
}

func (s *Service) UnbindProjectCharacterVoice(userID string, projectID string, assetID string) (ProjectCharacterDetail, error) {
	return s.projectDomain().UnbindProjectCharacterVoice(userID, projectID, assetID)
}

func isSupportedVoiceSampleMimeType(value string) bool {
	return localproject.SupportedVoiceSampleMimeType(value)
}
